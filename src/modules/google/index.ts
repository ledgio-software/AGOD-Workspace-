import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, driveFolders, googleConnections, projectAssignments, projects, tasks, users } from "@/lib/db/schema";
import { resolveBaseUrl } from "@/lib/env";
import {
  GoogleError,
  createFolder,
  deleteFile,
  downloadFile,
  driveFolderUrl,
  getFile,
  exchangeCode,
  listPermissions,
  refreshAccessToken,
  revokeToken,
  shareWith,
  unshare,
  uploadFile,
  userEmail,
} from "@/lib/google/client";
import { type GoogleConfig, googleConfig } from "@/lib/google/config";
import { openSecret, sealSecret } from "@/lib/google/secret";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError } from "@/modules/errors";

// Phase 21: the company Google account (Drive). An Admin connects one Google account (e.g. the
// team's Gmail); the app keeps its files in an "AGOD" folder there:
//
//   AGOD/                         shared (writer) with every active PM and Admin
//     <Customer>/                 per customer
//       Invoices/                 issued invoice PDFs
//       <AGOD-2026-001 Project>/  shared (writer) with the project's team members
//     Internal projects/
//       <AGOD-2026-002 Project>/
//     Payment receipts/           managers only (inherited from AGOD)
//
// With the drive.file scope the app only sees what it created there. Tokens and folder ids are
// only read here, through the owner connection; callers check permissions first.

export type Connection = typeof googleConnections.$inferSelect;
export type CompanyDrive = { config: GoogleConfig; connection: Connection; token: string };

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const isGoogleConfigured = () => googleConfig() !== null;
export const googleRedirectUri = () => `${resolveBaseUrl(process.env) ?? ""}/api/google/callback`;

// --- Connection and tokens --------------------------------------------------------------------

export async function companyConnection(): Promise<Connection | null> {
  const [row] = await db
    .select()
    .from(googleConnections)
    .where(and(eq(googleConnections.kind, "COMPANY"), isNull(googleConnections.disconnectedAt)));
  return row ?? null;
}

// Access tokens last an hour; reuse them within this server instance.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Drops cached access tokens, so the next call refreshes (tests simulate an expired token with it). */
export const clearGoogleTokenCache = () => tokenCache.clear();

function describeError(error: unknown): string {
  if (error instanceof GoogleError && (error.reason === "invalid_grant" || error.status === 401)) {
    return "Google no longer accepts the saved sign-in (it was revoked, the password changed, or it expired). Connect the account again.";
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function recordConnectionError(connectionId: string, error: unknown) {
  await db.update(googleConnections).set({ lastError: describeError(error), lastErrorAt: new Date() }).where(eq(googleConnections.id, connectionId));
}

async function accessTokenFor(config: GoogleConfig, connection: Connection): Promise<string> {
  const cached = tokenCache.get(connection.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  try {
    const result = await refreshAccessToken(config, openSecret(connection.refreshTokenEnc));
    tokenCache.set(connection.id, { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 });
    if (connection.lastError) {
      await db.update(googleConnections).set({ lastError: null, lastErrorAt: null }).where(eq(googleConnections.id, connection.id));
    }
    return result.access_token;
  } catch (error) {
    await recordConnectionError(connection.id, error);
    throw error;
  }
}

/**
 * Runs one Drive call; if Google says the access token is no longer valid, gets a new one and
 * tries once more (a refused refresh is recorded on the connection and thrown).
 */
async function call<T>(drive: CompanyDrive, request: (token: string) => Promise<T>): Promise<T> {
  try {
    return await request(drive.token);
  } catch (error) {
    if (!(error instanceof GoogleError && error.status === 401)) throw error;
    tokenCache.delete(drive.connection.id);
    drive.token = await accessTokenFor(drive.config, drive.connection);
    return request(drive.token);
  }
}

/** Google refused the stored sign-in itself: no point trying the other folders. */
const isSignInError = (error: unknown) => error instanceof GoogleError && (error.reason === "invalid_grant" || error.status === 401);

/** The company Drive, ready to call; null when Google isn't set up here or no account is connected. */
export async function companyDrive(): Promise<CompanyDrive | null> {
  const config = googleConfig();
  if (!config) return null;
  const connection = await companyConnection();
  if (!connection) return null;
  return { config, connection, token: await accessTokenFor(config, connection) };
}

/** Admin: finishes "Connect Google" (the OAuth callback). Returns the connected account's email. */
export async function completeCompanyConnect(actor: Actor, input: { code: string; verifier: string }, request?: RequestMeta): Promise<string> {
  assertCan(actor, "google.manage");
  const config = googleConfig();
  if (!config) throw new ServiceError("Google is not set up on this environment.");
  const tokens = await exchangeCode(config, { code: input.code, verifier: input.verifier, redirectUri: googleRedirectUri() });
  const granted = tokens.scope.split(" ");
  if (!granted.includes(DRIVE_FILE_SCOPE)) {
    await revokeToken(config, tokens.access_token);
    throw new ServiceError("Google Drive access was not allowed. Connect again and leave the Drive box ticked.");
  }
  if (!tokens.refresh_token) throw new ServiceError("Google did not return a lasting sign-in. Connect again.");
  const email = await userEmail(config, tokens.access_token);
  const sealed = sealSecret(tokens.refresh_token);

  const { connection, replaced } = await db.transaction(async (tx) => {
    const [active] = await tx
      .select()
      .from(googleConnections)
      .where(and(eq(googleConnections.kind, "COMPANY"), isNull(googleConnections.disconnectedAt)))
      .for("update");
    const fresh = { refreshTokenEnc: sealed, scopes: tokens.scope, userId: actor.id, connectedAt: new Date(), disconnectedAt: null, lastError: null, lastErrorAt: null };
    let row: Connection;
    let replaced: Connection | null = null;
    if (active && active.googleEmail === email) {
      [row] = await tx.update(googleConnections).set(fresh).where(eq(googleConnections.id, active.id)).returning();
    } else {
      if (active) {
        replaced = active;
        await tx.update(googleConnections).set({ disconnectedAt: new Date() }).where(eq(googleConnections.id, active.id));
      }
      // The same account connected before: reuse it, so its folders and stored files work again.
      const [previous] = await tx
        .select()
        .from(googleConnections)
        .where(and(eq(googleConnections.kind, "COMPANY"), eq(googleConnections.googleEmail, email)))
        .orderBy(desc(googleConnections.connectedAt))
        .limit(1);
      [row] = previous
        ? await tx.update(googleConnections).set(fresh).where(eq(googleConnections.id, previous.id)).returning()
        : await tx.insert(googleConnections).values({ kind: "COMPANY", googleEmail: email, ...fresh }).returning();
    }
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "google_connection",
      entityId: row.id,
      action: "google.connected",
      after: { googleEmail: email, scopes: tokens.scope },
      request,
    });
    return { connection: row, replaced };
  });
  tokenCache.set(connection.id, { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 });
  if (replaced) {
    tokenCache.delete(replaced.id);
    await revokeToken(config, openSecret(replaced.refreshTokenEnc));
  }
  // Create the folders and share them now (best effort: the daily job retries).
  await syncDrive().catch((error) => console.error("Drive sync after connecting failed", describeError(error)));
  return email;
}

/** Admin: stops using the company Google account. Its files stay in that Drive. */
export async function disconnectCompany(actor: Actor, request?: RequestMeta) {
  assertCan(actor, "google.manage");
  const connection = await companyConnection();
  if (!connection) throw new ServiceError("No Google account is connected.");
  await db.transaction(async (tx) => {
    await tx.update(googleConnections).set({ disconnectedAt: new Date() }).where(eq(googleConnections.id, connection.id));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "google_connection",
      entityId: connection.id,
      action: "google.disconnected",
      before: { googleEmail: connection.googleEmail },
      request,
    });
  });
  tokenCache.delete(connection.id);
  const config = googleConfig();
  if (config) await revokeToken(config, openSecret(connection.refreshTokenEnc));
}

/** Admin: the Integrations page card. */
export async function googleStatus(actor: Actor) {
  assertCan(actor, "audit.viewAll");
  const connection = await companyConnection();
  if (!connection) return { configured: isGoogleConfigured(), redirectUri: googleRedirectUri(), connection: null };
  const [by] = await db.select({ name: users.name }).from(users).where(eq(users.id, connection.userId));
  const [root] = await db
    .select({ webViewLink: driveFolders.webViewLink, folderId: driveFolders.folderId })
    .from(driveFolders)
    .where(and(eq(driveFolders.connectionId, connection.id), eq(driveFolders.purpose, "ROOT")));
  return {
    configured: isGoogleConfigured(),
    redirectUri: googleRedirectUri(),
    connection: {
      googleEmail: connection.googleEmail,
      connectedAt: connection.connectedAt,
      connectedBy: by?.name ?? null,
      lastError: connection.lastError,
      lastErrorAt: connection.lastErrorAt,
      lastSyncAt: connection.lastSyncAt,
      lastSync: connection.lastSync as DriveSyncSummary | null,
      rootUrl: root ? (root.webViewLink ?? driveFolderUrl(root.folderId)) : null,
    },
  };
}

// --- Folders ----------------------------------------------------------------------------------

type Purpose = "ROOT" | "CUSTOMER" | "CUSTOMER_INVOICES" | "PROJECT" | "INTERNAL" | "RECEIPTS";
type FolderSpec = { purpose: Purpose; entityId: string | null; name: string; parent: FolderSpec | null };

const ROOT: FolderSpec = { purpose: "ROOT", entityId: null, name: "AGOD", parent: null };
const INTERNAL: FolderSpec = { purpose: "INTERNAL", entityId: null, name: "Internal projects", parent: ROOT };
const RECEIPTS: FolderSpec = { purpose: "RECEIPTS", entityId: null, name: "Payment receipts", parent: ROOT };

const folderName = (name: string) => name.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200) || "Untitled";

async function customerSpec(customerId: string): Promise<FolderSpec> {
  const [customer] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
  if (!customer) throw new ServiceError("Customer not found.");
  return { purpose: "CUSTOMER", entityId: customerId, name: folderName(customer.name), parent: ROOT };
}

async function invoicesSpec(customerId: string): Promise<FolderSpec> {
  return { purpose: "CUSTOMER_INVOICES", entityId: customerId, name: "Invoices", parent: await customerSpec(customerId) };
}

async function projectSpec(projectId: string): Promise<FolderSpec> {
  const [project] = await db
    .select({ code: projects.code, name: projects.name, customerId: projects.customerId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new ServiceError("Project not found.");
  const parent = project.customerId ? await customerSpec(project.customerId) : INTERNAL;
  return { purpose: "PROJECT", entityId: projectId, name: folderName(`${project.code} ${project.name}`), parent };
}

const folderWhere = (connectionId: string, spec: { purpose: Purpose; entityId: string | null }) =>
  and(
    eq(driveFolders.connectionId, connectionId),
    eq(driveFolders.purpose, spec.purpose),
    spec.entityId ? eq(driveFolders.entityId, spec.entityId) : isNull(driveFolders.entityId),
  );

async function findFolder(connectionId: string, spec: { purpose: Purpose; entityId: string | null }) {
  const [row] = await db.select().from(driveFolders).where(folderWhere(connectionId, spec));
  return row ?? null;
}

/** Forgets a folder that is gone from Drive (deleted there), so it is created again. */
async function forgetFolder(connectionId: string, spec: FolderSpec) {
  await db.delete(driveFolders).where(folderWhere(connectionId, spec));
}

const isGone = (error: unknown) => error instanceof GoogleError && error.status === 404;

/** The folder's Drive id, creating it (and its parents) the first time. */
async function ensureFolder(drive: CompanyDrive, spec: FolderSpec): Promise<typeof driveFolders.$inferSelect> {
  const existing = await findFolder(drive.connection.id, spec);
  if (existing) return existing;
  let parentId = spec.parent ? (await ensureFolder(drive, spec.parent)).folderId : null;
  let created;
  try {
    created = await call(drive, (t) => createFolder(drive.config, t, spec.name, parentId));
  } catch (error) {
    if (!isGone(error) || !spec.parent) throw error;
    // The parent was deleted in Drive: make it again, once.
    await forgetFolder(drive.connection.id, spec.parent);
    parentId = (await ensureFolder(drive, spec.parent)).folderId;
    created = await call(drive, (t) => createFolder(drive.config, t, spec.name, parentId));
  }
  const [row] = await db
    .insert(driveFolders)
    .values({ connectionId: drive.connection.id, purpose: spec.purpose, entityId: spec.entityId, folderId: created.id, webViewLink: created.webViewLink ?? null })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // Another request created it at the same moment: keep theirs.
  await call(drive, (t) => deleteFile(drive.config, t, created.id)).catch(() => undefined);
  return (await findFolder(drive.connection.id, spec))!;
}

/** Runs `write` with the folder, re-creating the folder once if it was deleted in Drive. */
async function inFolder<T>(drive: CompanyDrive, spec: FolderSpec, write: (folderId: string) => Promise<T>): Promise<T> {
  const folder = await ensureFolder(drive, spec);
  try {
    return await write(folder.folderId);
  } catch (error) {
    if (!isGone(error)) throw error;
    await forgetFolder(drive.connection.id, spec);
    return write((await ensureFolder(drive, spec)).folderId);
  }
}

const folderLink = (row: { folderId: string; webViewLink: string | null }) => row.webViewLink ?? driveFolderUrl(row.folderId);

/** Link to an existing folder (no Google calls). Callers have already checked the person may see the entity. */
export async function driveFolderLink(purpose: "PROJECT" | "CUSTOMER", entityId: string): Promise<string | null> {
  const connection = await companyConnection();
  if (!connection || !isGoogleConfigured()) return null;
  const row = await findFolder(connection.id, { purpose, entityId });
  return row ? folderLink(row) : null;
}

/** Managers: create (or find) a project's Drive folder now and share it with the team. */
export async function createProjectFolder(actor: Actor, projectId: string): Promise<string> {
  assertCan(actor, "project.edit");
  const drive = await companyDrive();
  if (!drive) throw new ServiceError("Google Drive is not connected. An Admin connects it on the Integrations page.");
  const folder = await ensureFolder(drive, await projectSpec(projectId));
  await syncDrive({ projectIds: [projectId], drive });
  return folderLink(folder);
}

// --- Files ------------------------------------------------------------------------------------

const KEY_PREFIX = "gdrive:";
export const isDriveKey = (key: string) => key.startsWith(KEY_PREFIX);
const parseKey = (key: string) => {
  const [connectionId, fileId] = key.slice(KEY_PREFIX.length).split(":");
  return { connectionId, fileId };
};

export type DriveTarget = { kind: "PROJECT" | "TASK"; projectId: string } | { kind: "PAYMENT" };

/**
 * Stores an attachment in the company Drive (project folder, or Payment receipts). Returns its
 * storage key, or null when Drive isn't connected (the caller then uses the usual storage).
 */
export async function putInDrive(target: DriveTarget, file: { name: string; bytes: Uint8Array; contentType: string; description: string }): Promise<string | null> {
  const drive = await companyDrive();
  if (!drive) return null;
  const spec = target.kind === "PAYMENT" ? RECEIPTS : await projectSpec(target.projectId);
  const uploaded = await inFolder(drive, spec, (parentId) =>
    call(drive, (t) => uploadFile(drive.config, t, { name: file.name, parentId, bytes: file.bytes, contentType: file.contentType, description: file.description })),
  );
  return `${KEY_PREFIX}${drive.connection.id}:${uploaded.id}`;
}

async function driveFor(connectionId: string): Promise<CompanyDrive | null> {
  const config = googleConfig();
  if (!config || !/^[0-9a-f-]{36}$/i.test(connectionId)) return null;
  const [connection] = await db
    .select()
    .from(googleConnections)
    .where(and(eq(googleConnections.id, connectionId), isNull(googleConnections.disconnectedAt)));
  if (!connection) return null;
  return { config, connection, token: await accessTokenFor(config, connection) };
}

/** A stored file's bytes; null when it is gone or its Google account is no longer connected. */
export async function getFromDrive(key: string): Promise<Uint8Array | null> {
  const { connectionId, fileId } = parseKey(key);
  const drive = await driveFor(connectionId);
  if (!drive || !fileId) return null;
  return call(drive, (t) => downloadFile(drive.config, t, fileId));
}

export async function removeFromDrive(key: string): Promise<void> {
  const { connectionId, fileId } = parseKey(key);
  const drive = await driveFor(connectionId);
  if (drive && fileId) await call(drive, (t) => deleteFile(drive.config, t, fileId));
}

/** Saves an issued invoice's PDF in the customer's Invoices folder. Returns the Drive file id, or null when Drive isn't connected. */
export async function saveInvoicePdf(customerId: string, file: { name: string; bytes: Uint8Array; description: string }): Promise<string | null> {
  const drive = await companyDrive();
  if (!drive) return null;
  const uploaded = await inFolder(drive, await invoicesSpec(customerId), (parentId) =>
    call(drive, (t) => uploadFile(drive.config, t, { name: file.name, parentId, bytes: file.bytes, contentType: "application/pdf", description: file.description })),
  );
  return uploaded.id;
}

// --- Sharing ----------------------------------------------------------------------------------

export type DriveSyncSummary = { folders: number; shared: number; unshared: number; failures: string[] };

/** Projects whose folders are kept and shared daily; finished projects keep theirs as they are. */
const LIVE_STATUSES = ["DRAFT", "PLANNING", "IN_PROGRESS", "PENDING_APPROVAL", "CHANGES_REQUESTED"] as const;

/**
 * Makes sure the folders exist and are shared as they should be: AGOD with every active PM and
 * Admin; each live project's folder with its team members (owner, assigned people, task
 * assignees). Access the app granted is removed when it is no longer needed; sharing someone
 * added by hand in Drive is left alone.
 */
export async function syncDrive(options: { projectIds?: string[]; drive?: CompanyDrive } = {}): Promise<DriveSyncSummary | null> {
  const drive = options.drive ?? (await companyDrive());
  if (!drive) return null;
  const summary: DriveSyncSummary = { folders: 0, shared: 0, unshared: 0, failures: [] };
  const own = drive.connection.googleEmail.toLowerCase();

  const people = await db
    .select({ id: users.id, role: users.role, email: users.email, personal: googleConnections.googleEmail })
    .from(users)
    .leftJoin(
      googleConnections,
      and(eq(googleConnections.userId, users.id), eq(googleConnections.kind, "PERSONAL"), isNull(googleConnections.disconnectedAt)),
    )
    .where(eq(users.active, true));
  // Their Google account: the one they connected (Phase 22), else the email they sign in with.
  const emailOf = new Map(people.map((p) => [p.id, (p.personal ?? p.email).toLowerCase()]));
  const managers = people.filter((p) => p.role !== "TEAM_MEMBER").map((p) => emailOf.get(p.id)!);

  const sync = async (spec: FolderSpec, wanted: string[]) => {
    try {
      const folder = await ensureFolder(drive, spec);
      summary.folders += 1;
      const desired = [...new Set(wanted.filter((e) => e !== own))].sort();
      const before = ((folder.sharedWith as string[]) ?? []).slice().sort();
      if (desired.join() === before.join()) return;
      const current = await call(drive, (t) => listPermissions(drive.config, t, folder.folderId));
      const has = new Map(current.filter((p) => p.type === "user" && p.emailAddress).map((p) => [p.emailAddress!.toLowerCase(), p]));
      const after = new Set(before.filter((e) => has.has(e)));
      for (const email of desired) {
        if (has.has(email)) {
          after.add(email);
          continue;
        }
        try {
          await call(drive, (t) => shareWith(drive.config, t, folder.folderId, email, "writer"));
          after.add(email);
          summary.shared += 1;
        } catch (error) {
          if (isSignInError(error)) throw error;
          summary.failures.push(`${spec.name}: ${email} — ${describeError(error)}`);
        }
      }
      for (const email of before) {
        const permission = has.get(email);
        if (desired.includes(email)) continue;
        try {
          if (permission && permission.role !== "owner") {
            await call(drive, (t) => unshare(drive.config, t, folder.folderId, permission.id));
            summary.unshared += 1;
          }
          after.delete(email);
        } catch (error) {
          if (isSignInError(error)) throw error;
          summary.failures.push(`${spec.name}: removing ${email} — ${describeError(error)}`);
        }
      }
      await db.update(driveFolders).set({ sharedWith: [...after].sort() }).where(eq(driveFolders.id, folder.id));
    } catch (error) {
      if (isSignInError(error)) throw error;
      summary.failures.push(`${spec.name} — ${describeError(error)}`);
    }
  };

  if (!options.projectIds) {
    // Everything lives inside AGOD: if it was deleted (or trashed) in Drive, start again.
    const root = await findFolder(drive.connection.id, ROOT);
    if (root) {
      const found = await call(drive, (t) => getFile(drive.config, t, root.folderId));
      if (!found || found.trashed) await db.delete(driveFolders).where(eq(driveFolders.connectionId, drive.connection.id));
    }
    await sync(ROOT, managers);
    for (const spec of [INTERNAL, RECEIPTS]) await sync(spec, []);
  }

  const list = await db
    .select({ id: projects.id, ownerId: projects.projectOwnerId })
    .from(projects)
    .where(options.projectIds ? inArray(projects.id, options.projectIds) : inArray(projects.status, [...LIVE_STATUSES]))
    .orderBy(asc(projects.createdAt));
  if (list.length > 0) {
    const ids = list.map((p) => p.id);
    const assigned = await db
      .select({ projectId: projectAssignments.projectId, userId: projectAssignments.memberId })
      .from(projectAssignments)
      .where(and(inArray(projectAssignments.projectId, ids), eq(projectAssignments.active, true)));
    const taskPeople = await db
      .selectDistinct({ projectId: tasks.projectId, userId: tasks.assignedTo })
      .from(tasks)
      .where(and(inArray(tasks.projectId, ids), sql`${tasks.assignedTo} IS NOT NULL`));
    const memberIds = new Set(people.filter((p) => p.role === "TEAM_MEMBER").map((p) => p.id));
    for (const project of list) {
      const team = [project.ownerId, ...assigned.filter((a) => a.projectId === project.id).map((a) => a.userId), ...taskPeople.filter((t) => t.projectId === project.id).map((t) => t.userId!)];
      // Managers already reach every folder through AGOD.
      await sync(await projectSpec(project.id), team.filter((id) => memberIds.has(id)).map((id) => emailOf.get(id)!));
    }
  }

  if (!options.projectIds) {
    await db
      .update(googleConnections)
      .set({ lastSyncAt: new Date(), lastSync: { ...summary, failures: summary.failures.slice(0, 20) } })
      .where(eq(googleConnections.id, drive.connection.id));
  }
  return summary;
}

/** Admin: "Sync now" on the Integrations page. */
export async function syncDriveNow(actor: Actor): Promise<DriveSyncSummary> {
  assertCan(actor, "google.manage");
  const drive = await companyDrive().catch((error) => {
    throw new ServiceError(describeError(error));
  });
  if (!drive) throw new ServiceError("No Google account is connected.");
  try {
    return (await syncDrive({ drive }))!;
  } catch (error) {
    throw new ServiceError(describeError(error));
  }
}
