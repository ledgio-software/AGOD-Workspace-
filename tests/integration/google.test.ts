import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, driveFolders, googleConnections, invoices, projectAssignments, projectLinks } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { authorizationUrl, newAuthRequest } from "@/lib/google/client";
import { COMPANY_SCOPES, googleConfig } from "@/lib/google/config";
import { openAttempt, sealAttempt } from "@/lib/google/oauth-cookie";
import { type Actor, PermissionError } from "@/lib/permissions";
import { approveProject, requestApproval } from "@/modules/approvals";
import { attachmentsAvailable, openAttachment, uploadAttachment } from "@/modules/attachments";
import { createCustomer } from "@/modules/customers";
import {
  clearGoogleTokenCache,
  companyConnection,
  completeCompanyConnect,
  createProjectFolder,
  disconnectCompany,
  driveFolderLink,
  googleRedirectUri,
  googleStatus,
  syncDrive,
} from "@/modules/google";
import { addInvoiceLine, createDraftInvoice, issueInvoice } from "@/modules/invoices";
import { saveInvoiceToDrive } from "@/modules/invoices/drive";
import { addProjectLink, listProjectLinks, removeProjectLink } from "@/modules/links";
import { recordPayment } from "@/modules/payments";
import { changeProjectStatus, createProject } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { createTask, updateTaskProgress } from "@/modules/tasks";
import { type FakeGoogle, childrenOf, fakeGoogleEnv, sharedWith, startFakeGoogle } from "../support/fake-google";
import { TEST_ORG_ID, createUser, db, expectDbError } from "./fixtures";

vi.mock("server-only", () => ({}));

let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
  for (const [k, v] of Object.entries(fakeGoogleEnv(google.url))) vi.stubEnv(k, v);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("LOCAL_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "agod-uploads-")));
});

afterAll(async () => {
  await db.update(googleConnections).set({ disconnectedAt: new Date() }).where(isNull(googleConnections.disconnectedAt));
  vi.unstubAllEnvs();
  await google.close();
});

beforeEach(async () => {
  // One company account at a time: start each test without one.
  await db.update(googleConnections).set({ disconnectedAt: new Date() }).where(isNull(googleConnections.disconnectedAt));
  clearGoogleTokenCache();
  google.account.email = `team-${randomUUID().slice(0, 8)}@gmail.com`;
  google.account.grantDrive = true;
});

/** Goes through the fake consent screen and finishes the connection, like /api/google/callback. */
async function connect(admin: Actor) {
  const config = googleConfig()!;
  const attempt = newAuthRequest();
  const response = await fetch(authorizationUrl(config, { redirectUri: googleRedirectUri(), scopes: COMPANY_SCOPES, state: attempt.state, challenge: attempt.challenge }), {
    redirect: "manual",
  });
  const back = new URL(response.headers.get("location")!);
  expect(back.origin + back.pathname).toBe("http://localhost:3000/api/google/callback");
  expect(back.searchParams.get("state")).toBe(attempt.state);
  return completeCompanyConnect(admin, { code: back.searchParams.get("code")!, verifier: attempt.verifier });
}

/** The current account's folder for a purpose, as the app recorded it. */
async function folder(purpose: string, entityId: string | null = null) {
  const connection = (await companyConnection(TEST_ORG_ID))!;
  const rows = await db.select().from(driveFolders).where(and(eq(driveFolders.connectionId, connection.id), eq(driveFolders.purpose, purpose)));
  const row = rows.find((r) => r.entityId === entityId)!;
  return google.files.get(row.folderId)!;
}
const rootFolder = () => folder("ROOT");

async function team() {
  const admin = await createUser("ADMIN");
  const pm = await createUser("PROJECT_MANAGER");
  const member = await createUser("TEAM_MEMBER");
  const other = await createUser("TEAM_MEMBER");
  const project = await createProject(pm, { name: `Drive ${randomUUID().slice(0, 6)}`, clientType: "INTERNAL", totalValue: "1000", splitMode: "PERCENTAGE", projectOwnerId: pm.id });
  await addAssignment(pm, project.id, { memberId: member.id, roleOnProject: "Dev", split: "100" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  const task = await createTask(pm, project.id, { title: "Build", assignedTo: member.id });
  return { admin, pm, member, other, project, task };
}

const email = (u: { id: string }) => `${u.id}@agod.test`;

describe("connecting the company Google account", () => {
  it("is Admin-only, stores the sign-in encrypted, and creates and shares the company folder", async () => {
    const { admin, pm, member } = await team();
    await expect(completeCompanyConnect(pm, { code: "x", verifier: "y" })).rejects.toThrow(PermissionError);

    const connected = await connect(admin);
    expect(connected).toBe(google.account.email);
    const connection = (await companyConnection(TEST_ORG_ID))!;
    expect(connection.googleEmail).toBe(google.account.email);
    expect(connection.refreshTokenEnc).toMatch(/^v1\./);
    expect(connection.refreshTokenEnc).not.toContain("rt-");

    // AGOD is shared with every active manager, not with members.
    const root = await rootFolder();
    expect(root.name).toBe("Test company");
    const shared = sharedWith(google, root.id);
    expect(shared).toEqual(expect.arrayContaining([email(admin), email(pm)]));
    expect(shared).not.toContain(email(member));
    expect(childrenOf(google, root.id).map((f) => f.name)).toEqual(expect.arrayContaining(["Internal projects", "Payment receipts"]));

    const status = await googleStatus(admin);
    expect(status.connection?.googleEmail).toBe(google.account.email);
    expect(status.connection?.rootUrl).toContain(root.id);
    expect(status.connection?.lastSync?.folders).toBeGreaterThan(0);
    const [audit] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, connection.id), eq(auditEvents.action, "google.connected")));
    expect(audit.actorId).toBe(admin.id);
  });

  it("refuses a connection without Drive access, and the OAuth cookie only works for the same person and state", async () => {
    const { admin } = await team();
    google.account.grantDrive = false;
    await expect(connect(admin)).rejects.toThrow(/Drive access/);
    expect(await companyConnection(TEST_ORG_ID)).toBeNull();

    const cookie = sealAttempt({ state: "s1", verifier: "v1", userId: admin.id, orgId: TEST_ORG_ID });
    expect(openAttempt(cookie, { state: "s1", userId: admin.id, orgId: TEST_ORG_ID })?.verifier).toBe("v1");
    expect(openAttempt(cookie, { state: "s2", userId: admin.id, orgId: TEST_ORG_ID })).toBeNull();
    expect(openAttempt(cookie, { state: "s1", userId: randomUUID(), orgId: TEST_ORG_ID })).toBeNull();
    expect(openAttempt(cookie, { state: "s1", userId: admin.id, orgId: TEST_ORG_ID }, Date.now() + 11 * 60_000)).toBeNull();
    const tampered = cookie.slice(0, 20) + (cookie[20] === "A" ? "B" : "A") + cookie.slice(21);
    expect(openAttempt(tampered, { state: "s1", userId: admin.id, orgId: TEST_ORG_ID })).toBeNull();
  });
});

describe("files in Drive", () => {
  it("stores uploads in the project folder, shares it with the team, and serves them back", async () => {
    const { admin, pm, member, other, project, task } = await team();
    await connect(admin);
    expect(await attachmentsAvailable(TEST_ORG_ID)).toBe(true);

    const doc = await uploadAttachment(pm, { kind: "PROJECT", projectId: project.id }, { name: "brief.txt", bytes: new TextEncoder().encode("Scope v1") });
    await uploadAttachment(member, { kind: "TASK", taskId: task.id }, { name: "design.pdf", bytes: new TextEncoder().encode("%PDF-1.7 design") });
    expect(doc.storageKey).toMatch(/^gdrive:/);

    const projectFolder = await folder("PROJECT", project.id);
    expect(projectFolder.name).toBe(`${project.code} ${project.name}`);
    expect(projectFolder.parents).toEqual([(await folder("INTERNAL")).id]);
    expect(childrenOf(google, projectFolder.id).map((f) => f.name).sort()).toEqual(["brief.txt", "design.pdf"]);
    expect(await driveFolderLink(TEST_ORG_ID, "PROJECT", project.id)).toContain(projectFolder.id);

    const opened = await openAttachment(member, doc.id);
    expect(opened && new TextDecoder().decode(opened.body as Uint8Array)).toBe("Scope v1");
    expect(await openAttachment(other, doc.id)).toBeNull();

    // Sharing: the member gets the project folder; when they leave the project, the access the app gave goes.
    await syncDrive(TEST_ORG_ID, { projectIds: [project.id] });
    expect(sharedWith(google, projectFolder.id)).toEqual([email(member)]);
    await db.update(projectAssignments).set({ active: false }).where(eq(projectAssignments.memberId, member.id));
    await db.execute(`UPDATE tasks SET assigned_to = NULL WHERE id = '${task.id}'`);
    // Someone shared it by hand in Drive: the app leaves that alone.
    google.permissions.get(projectFolder.id)!.push({ id: "manual", type: "user", role: "reader", emailAddress: "client@example.com" });
    const summary = await syncDrive(TEST_ORG_ID, { projectIds: [project.id] });
    expect(summary?.unshared).toBe(1);
    expect(sharedWith(google, projectFolder.id)).toEqual(["client@example.com"]);
  });

  it("re-creates a folder deleted in Drive, and reports people Drive can't share with", async () => {
    const { admin, pm, project } = await team();
    await connect(admin);
    const first = await createProjectFolder(pm, project.id);
    const folderId = /folders\/([^/?]+)/.exec(first)![1];
    google.files.delete(folderId);
    const file = await uploadAttachment(pm, { kind: "PROJECT", projectId: project.id }, { name: "notes.txt", bytes: new TextEncoder().encode("again") });
    const [row] = await db.select().from(driveFolders).where(and(eq(driveFolders.purpose, "PROJECT"), eq(driveFolders.entityId, project.id)));
    expect(row.folderId).not.toBe(folderId);
    expect(google.files.get(file.storageKey.split(":")[2])?.parents).toEqual([row.folderId]);

    // The whole company folder deleted in Drive: the next sync builds it again.
    const oldRoot = (await rootFolder()).id;
    for (const f of [...google.files.values()]) google.files.delete(f.id);
    await syncDrive(TEST_ORG_ID);
    const newRoot = await rootFolder();
    expect(newRoot.id).not.toBe(oldRoot);
    expect(sharedWith(google, newRoot.id)).toContain(email(admin));

    const outsider = await createUser("TEAM_MEMBER");
    await db.execute(`UPDATE users SET email = 'x-${outsider.id.slice(0, 8)}@nogoogle.test' WHERE id = '${outsider.id}'`);
    await addAssignment(pm, project.id, { memberId: outsider.id, roleOnProject: "QA", split: "0" });
    const summary = await syncDrive(TEST_ORG_ID, { projectIds: [project.id] });
    expect(summary?.failures.join()).toMatch(/nogoogle\.test.*no Google account/);
  });

  it("puts payment receipts in the Payment receipts folder", async () => {
    const { admin, pm, member, project, task } = await team();
    await connect(admin);
    await updateTaskProgress(member, task.id, { status: "DONE", completionNote: "Delivered", completedOn: todayInOperatingZone() });
    await requestApproval(pm, project.id);
    const [{ version }] = await db.execute<{ version: number }>(`SELECT version FROM projects WHERE id = '${project.id}'`).then((r) => r.rows);
    await approveProject(pm, project.id, { expectedVersion: version });
    const [entry] = await db.execute<{ id: string }>(`SELECT id FROM payout_ledger_entries WHERE member_id = '${member.id}'`).then((r) => r.rows);
    const { payment } = await recordPayment(admin, entry.id, { amount: "100.00", method: "MOBILE_MONEY", paidOn: todayInOperatingZone() });
    const receipt = await uploadAttachment(admin, { kind: "PAYMENT", paymentId: payment.id }, { name: "momo.pdf", bytes: new TextEncoder().encode("%PDF-1.7 momo") });
    expect(google.files.get(receipt.storageKey.split(":")[2])?.parents).toEqual([(await folder("RECEIPTS")).id]);
    const opened = await openAttachment(member, receipt.id);
    expect(opened && new TextDecoder().decode(opened.body as Uint8Array)).toContain("momo");
  });

  it("falls back to the app's storage when Google refuses, and records why", async () => {
    const { admin, pm, project } = await team();
    await connect(admin);
    const inDrive = await uploadAttachment(pm, { kind: "PROJECT", projectId: project.id }, { name: "a.txt", bytes: new TextEncoder().encode("drive") });
    google.revokeAll();

    const local = await uploadAttachment(pm, { kind: "PROJECT", projectId: project.id }, { name: "b.txt", bytes: new TextEncoder().encode("local") });
    expect(local.storageKey).toMatch(/^projects\//);
    expect((await companyConnection(TEST_ORG_ID))?.lastError).toMatch(/Connect the account again/);
    expect(await openAttachment(pm, inDrive.id)).toBeNull();

    // Reconnecting the same account brings the Drive files back.
    await connect(admin);
    const opened = await openAttachment(pm, inDrive.id);
    expect(opened && new TextDecoder().decode(opened.body as Uint8Array)).toBe("drive");
    expect((await companyConnection(TEST_ORG_ID))?.lastError).toBeNull();

    await disconnectCompany(admin);
    expect(await companyConnection(TEST_ORG_ID)).toBeNull();
    expect([...google.refreshTokens.values()].every((t) => t.revoked)).toBe(true);
    expect(await openAttachment(pm, inDrive.id)).toBeNull();
  });
});

describe("invoices in Drive", () => {
  it("saves the issued PDF in the customer's Invoices folder once", async () => {
    const { admin, pm } = await team();
    await connect(admin);
    const customer = await createCustomer(pm, { name: `Drive customer ${randomUUID().slice(0, 8)}`, type: "COMPANY", status: "ACTIVE", ownerId: pm.id });
    const draft = await createDraftInvoice(pm, { customerId: customer.id });
    await addInvoiceLine(pm, draft.id, { description: "Setup", quantity: 1, unitPrice: "100" });
    await expect(saveInvoiceToDrive(pm, draft.id)).rejects.toThrow(/Only issued/);
    const [current] = await db.select().from(invoices).where(eq(invoices.id, draft.id));
    const today = todayInOperatingZone();
    const issued = await issueInvoice(pm, draft.id, { issueDate: today, dueDate: today, version: current.version });

    expect(await saveInvoiceToDrive(pm, draft.id)).toBe("saved");
    expect(await saveInvoiceToDrive(pm, draft.id)).toBe("already");
    const [after] = await db.select().from(invoices).where(eq(invoices.id, draft.id));
    const pdf = google.files.get(after.driveFileId!)!;
    expect(pdf.name).toBe(`${issued.number}.pdf`);
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const invoicesFolder = google.files.get(pdf.parents[0])!;
    expect(invoicesFolder.name).toBe("Invoices");
    expect(google.files.get(invoicesFolder.parents[0])?.name).toBe(customer.name);
    expect(await driveFolderLink(TEST_ORG_ID, "CUSTOMER", customer.id)).toContain(invoicesFolder.parents[0]);
  });
});

describe("project links", () => {
  it("managers link to any project or task, members to their own tasks; removal is soft and guarded", async () => {
    const { pm, member, other, project, task } = await team();
    const otherTask = await createTask(pm, project.id, { title: "Review" });

    const spec = await addProjectLink(pm, { projectId: project.id, url: "https://docs.google.com/document/d/abc/edit" });
    expect(spec).toMatchObject({ provider: "GOOGLE_DRIVE", title: "Google Doc", taskId: null });
    const mine = await addProjectLink(member, { projectId: project.id, taskId: task.id, url: "https://www.figma.com/file/x", title: "Mockups" });
    await expect(addProjectLink(member, { projectId: project.id, url: "https://example.com" })).rejects.toThrow(PermissionError);
    await expect(addProjectLink(member, { projectId: project.id, taskId: otherTask.id, url: "https://example.com" })).rejects.toThrow(PermissionError);
    await expect(addProjectLink(pm, { projectId: project.id, url: "javascript:alert(1)" })).rejects.toThrow(/https/);

    const listed = await listProjectLinks(member, project.id);
    expect(listed.project.map((l) => l.title)).toEqual(["Google Doc"]);
    expect(listed.byTask.get(task.id)?.map((l) => l.title)).toEqual(["Mockups"]);
    expect((await listProjectLinks(other, project.id)).project).toEqual([]);

    await expect(removeProjectLink(member, spec.id)).rejects.toThrow(PermissionError);
    await removeProjectLink(member, mine.id);
    await expect(removeProjectLink(pm, mine.id)).rejects.toThrow(/not found/);

    // The database refuses what the service would never do.
    await expectDbError(withActor(pm, (tx) => tx.update(projectLinks).set({ url: "https://evil.example" }).where(eq(projectLinks.id, spec.id))), /only be removed/);
    await expectDbError(db.delete(projectLinks).where(eq(projectLinks.id, spec.id)), /cannot be deleted/);
    await expectDbError(
      withActor(pm, (tx) => tx.insert(projectLinks).values({ projectId: project.id, taskId: randomUUID(), url: "https://x.test", title: "x", provider: "WEB", addedBy: pm.id })),
      /.+/,
    );
    await expectDbError(
      withActor(member, (tx) => tx.insert(projectLinks).values({ projectId: project.id, url: "https://x.test", title: "x", provider: "WEB", addedBy: member.id })),
      /row-level security/,
    );
  });

  it("keeps Google tokens and folders away from the app role", async () => {
    const { admin } = await team();
    await expectDbError(withActor(admin, (tx) => tx.select().from(googleConnections)), /permission denied/);
    await expectDbError(withActor(admin, (tx) => tx.select().from(driveFolders)), /permission denied/);
  });
});
