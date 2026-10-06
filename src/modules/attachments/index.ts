import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { withActor } from "@/lib/db/actor";
import { attachments, paymentTransactions, payoutLedgerEntries, tasks, users } from "@/lib/db/schema";
import { checkFile } from "@/lib/files";
import { type Actor, assertCan } from "@/lib/permissions";
import { storage } from "@/lib/storage";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { companyConnection, getFromDrive, isDriveKey, isGoogleConfigured, putInDrive, removeFromDrive } from "@/modules/google";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";

// File attachments (roadmap Stage 2; "payment receipt upload with controlled access").
// Who may upload: managers (project documents), managers and the assignee (task files),
// Admins (payment receipts). Who may see: like the thing the file is attached to. Files are
// stored privately and served only through /files/<id>, which checks access every time.
// Phase 21: when the company Google Drive is connected, new files go to the project's Drive
// folder (receipts to "Payment receipts"); earlier files stay where they were stored.

export type AttachmentTarget =
  | { kind: "PROJECT"; projectId: string }
  | { kind: "TASK"; taskId: string }
  | { kind: "PAYMENT"; paymentId: string };

export const attachmentsAvailable = async (orgId: string) => storage() !== null || (isGoogleConfigured() && (await companyConnection(orgId)) !== null);

const removeStored = (key: string) => (isDriveKey(key) ? removeFromDrive(key) : (storage()?.remove(key) ?? Promise.resolve()));

/** Resolves the project and checks the uploader's role before anything is stored. */
async function resolveTarget(actor: Actor, target: AttachmentTarget) {
  return withActor(actor, async (tx) => {
    if (target.kind === "PROJECT") {
      assertCan(actor, "project.edit");
      return { projectId: target.projectId, taskId: null, paymentId: null };
    }
    if (target.kind === "TASK") {
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, target.taskId));
      if (!task) throw new ServiceError("Task not found.");
      assertCan(actor, "task.update", { isTaskAssignee: task.assignedTo === actor.id });
      return { projectId: task.projectId, taskId: task.id, paymentId: null };
    }
    assertCan(actor, "payment.record");
    const [row] = await tx
      .select({ projectId: payoutLedgerEntries.projectId })
      .from(paymentTransactions)
      .innerJoin(payoutLedgerEntries, eq(payoutLedgerEntries.id, paymentTransactions.ledgerEntryId))
      .where(eq(paymentTransactions.id, target.paymentId));
    if (!row) throw new ServiceError("Payment not found.");
    return { projectId: row.projectId, taskId: null, paymentId: target.paymentId };
  });
}

export async function uploadAttachment(
  actor: Actor,
  target: AttachmentTarget,
  file: { name: string; bytes: Uint8Array },
  request?: RequestMeta,
) {
  const checked = checkFile(file.name, file.bytes);
  if ("error" in checked) throw new ServiceError(checked.error);
  const resolved = await resolveTarget(actor, target);
  const store = storage();

  let storageKey: string | null = null;
  try {
    storageKey = await putInDrive(actor.orgId, target.kind === "PAYMENT" ? { kind: "PAYMENT" } : { kind: target.kind, projectId: resolved.projectId }, {
      name: checked.fileName,
      bytes: file.bytes,
      contentType: checked.contentType,
      description: "Uploaded through the AGOD Payout Tracker",
    });
  } catch (error) {
    // Google is down or refused: use the usual storage if there is one.
    console.error("Drive upload failed", error instanceof Error ? error.message : error);
    if (!store) throw new ServiceError("Google Drive refused the upload. Try again, or ask an Admin to check Google on the Integrations page.");
  }
  if (!storageKey) {
    if (!store) throw new ServiceError("File uploads are not set up in this environment yet.");
    const key = `projects/${resolved.projectId}/${randomUUID()}/${checked.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    storageKey = await store.put(key, file.bytes, checked.contentType);
  }
  const stored = storageKey;
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(attachments)
        .values({
          kind: target.kind,
          ...resolved,
          fileName: checked.fileName,
          contentType: checked.contentType,
          sizeBytes: checked.sizeBytes,
          storageKey,
          uploadedBy: actor.id,
        })
        .returning()
        .catch(rethrowDbGuard);
      await recordAudit(tx, {
        actorId: actor.id,
        entityType: "attachment",
        entityId: row.id,
        projectId: resolved.projectId,
        action: "attachment.uploaded",
        after: { kind: row.kind, fileName: row.fileName, sizeBytes: row.sizeBytes, taskId: row.taskId, paymentId: row.paymentId },
        request,
      });
      return row;
    });
  } catch (error) {
    // Refused by the database (e.g. row-level security): don't leave an orphaned file behind.
    await removeStored(stored).catch(() => undefined);
    throw error;
  }
}

/** Soft removal by the uploader or a manager; payment receipts are never removed. */
export async function removeAttachment(actor: Actor, id: string, request?: RequestMeta) {
  await withActor(actor, async (tx) => {
    const [row] = await tx.select().from(attachments).where(eq(attachments.id, id));
    if (!row || row.removedAt) throw new ServiceError("File not found.");
    if (row.kind === "PAYMENT") throw new ServiceError("Payment receipts cannot be removed.");
    if (row.uploadedBy !== actor.id) assertCan(actor, "project.edit");
    await tx
      .update(attachments)
      .set({ removedAt: new Date(), removedBy: actor.id })
      .where(eq(attachments.id, id))
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "attachment",
      entityId: id,
      projectId: row.projectId,
      action: "attachment.removed",
      before: { fileName: row.fileName, kind: row.kind },
      request,
    });
  });
}

export type AttachmentView = { id: string; fileName: string; sizeBytes: number; createdAt: Date; uploadedBy: string; uploaderName: string };

const view = { id: attachments.id, fileName: attachments.fileName, sizeBytes: attachments.sizeBytes, createdAt: attachments.createdAt, uploadedBy: attachments.uploadedBy, uploaderName: users.name };

/** Current files of a project, split into project documents and files per task. */
export async function listProjectAttachments(actor: Actor, projectId: string) {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({ ...view, kind: attachments.kind, taskId: attachments.taskId })
      .from(attachments)
      .innerJoin(users, eq(users.id, attachments.uploadedBy))
      .where(and(eq(attachments.projectId, projectId), isNull(attachments.removedAt), inArray(attachments.kind, ["PROJECT", "TASK"])))
      .orderBy(asc(attachments.createdAt));
    const byTask = new Map<string, AttachmentView[]>();
    for (const r of rows.filter((r) => r.kind === "TASK" && r.taskId)) byTask.set(r.taskId!, [...(byTask.get(r.taskId!) ?? []), r]);
    return { project: rows.filter((r) => r.kind === "PROJECT"), byTask };
  });
}

/** Receipts per payment (row-level security limits them to managers and the payee). */
export async function listPaymentReceipts(actor: Actor, paymentIds: string[]) {
  if (paymentIds.length === 0) return new Map<string, AttachmentView[]>();
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({ ...view, paymentId: attachments.paymentId })
      .from(attachments)
      .innerJoin(users, eq(users.id, attachments.uploadedBy))
      .where(and(inArray(attachments.paymentId, paymentIds), isNull(attachments.removedAt)))
      .orderBy(asc(attachments.createdAt));
    const map = new Map<string, AttachmentView[]>();
    for (const r of rows) map.set(r.paymentId!, [...(map.get(r.paymentId!) ?? []), r]);
    return map;
  });
}

/** For the download route: the file, if this person may see it. */
export async function openAttachment(actor: Actor, id: string) {
  const row = await withActor(actor, async (tx) => (await tx.select().from(attachments).where(eq(attachments.id, id)))[0]);
  if (!row || row.removedAt) return null;
  if (isDriveKey(row.storageKey)) {
    const bytes = await getFromDrive(row.storageKey).catch((error) => {
      console.error("Drive download failed", error instanceof Error ? error.message : error);
      return null;
    });
    return bytes ? { row, body: bytes } : null;
  }
  const store = storage();
  if (!store) return null;
  const file = await store.get(row.storageKey);
  return file ? { row, body: file.body } : null;
}
