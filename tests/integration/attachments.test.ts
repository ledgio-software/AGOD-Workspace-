import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withActor } from "@/lib/db/actor";
import { attachments, payoutLedgerEntries, projects } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { PermissionError } from "@/lib/permissions";
import { approveProject, requestApproval } from "@/modules/approvals";
import {
  listPaymentReceipts,
  listProjectAttachments,
  openAttachment,
  removeAttachment,
  uploadAttachment,
} from "@/modules/attachments";
import { ServiceError } from "@/modules/errors";
import { recordPayment } from "@/modules/payments";
import { changeProjectStatus, createProject } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { createTask, updateTaskProgress } from "@/modules/tasks";
import { createUser, db, expectDbError } from "./fixtures";

vi.mock("server-only", () => ({}));

beforeAll(() => vi.stubEnv("LOCAL_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "agod-uploads-"))));
afterAll(() => vi.unstubAllEnvs());

const pdf = (text = "receipt") => ({ name: "receipt.pdf", bytes: new TextEncoder().encode(`%PDF-1.7\n${text}`) });
const readAll = async (body: ReadableStream<Uint8Array> | Uint8Array) =>
  body instanceof Uint8Array ? new TextDecoder().decode(body) : await new Response(body).text();

async function setup() {
  const pm = await createUser("PROJECT_MANAGER");
  const admin = await createUser("ADMIN");
  const a = await createUser("TEAM_MEMBER");
  const b = await createUser("TEAM_MEMBER");
  const outsider = await createUser("TEAM_MEMBER");
  const project = await createProject(pm, { name: `Files ${crypto.randomUUID().slice(0, 6)}`, clientType: "INTERNAL", totalValue: "1000", splitMode: "PERCENTAGE", projectOwnerId: pm.id });
  await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Dev", split: "50" });
  await addAssignment(pm, project.id, { memberId: b.id, roleOnProject: "QA", split: "50" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  const task = await createTask(pm, project.id, { title: "Design", assignedTo: a.id });
  return { pm, admin, a, b, outsider, project, task };
}

describe("project and task files", () => {
  it("uploads, lists, serves and removes files with the right people", async () => {
    const { pm, a, b, outsider, project, task } = await setup();
    await expect(uploadAttachment(a, { kind: "PROJECT", projectId: project.id }, pdf())).rejects.toThrow(PermissionError);
    const doc = await uploadAttachment(pm, { kind: "PROJECT", projectId: project.id }, { name: "brief.txt", bytes: new TextEncoder().encode("Scope v1") });
    const evidence = await uploadAttachment(a, { kind: "TASK", taskId: task.id }, pdf("design"));
    await expect(uploadAttachment(b, { kind: "TASK", taskId: task.id }, pdf())).rejects.toThrow(PermissionError);
    await expect(uploadAttachment(a, { kind: "TASK", taskId: task.id }, { name: "x.pdf", bytes: new TextEncoder().encode("<script>") })).rejects.toThrow(
      /does not match/,
    );

    const listed = await listProjectAttachments(b, project.id);
    expect(listed.project.map((f) => f.fileName)).toEqual(["brief.txt"]);
    expect(listed.byTask.get(task.id)?.map((f) => f.fileName)).toEqual(["receipt.pdf"]);

    const opened = await openAttachment(b, evidence.id);
    expect(opened && (await readAll(opened.body))).toContain("design");
    expect(await openAttachment(outsider, evidence.id)).toBeNull();

    await expect(removeAttachment(b, evidence.id)).rejects.toThrow(PermissionError);
    await removeAttachment(a, evidence.id);
    expect(await openAttachment(pm, evidence.id)).toBeNull();
    await expect(removeAttachment(pm, evidence.id)).rejects.toThrow(ServiceError);
    await removeAttachment(pm, doc.id);
    expect((await listProjectAttachments(pm, project.id)).project).toEqual([]);
  });

  it("the database refuses outsiders, edits and hard deletes", async () => {
    const { a, outsider, project, task } = await setup();
    const file = await uploadAttachment(a, { kind: "TASK", taskId: task.id }, pdf());
    await expectDbError(
      withActor(outsider, (tx) =>
        tx.insert(attachments).values({ kind: "TASK", projectId: project.id, taskId: task.id, fileName: "x", contentType: "text/plain", sizeBytes: 1, storageKey: "k", uploadedBy: outsider.id }),
      ),
      /row-level security/,
    );
    await expectDbError(withActor(a, (tx) => tx.update(attachments).set({ fileName: "renamed.pdf" }).where(eq(attachments.id, file.id))), /cannot be edited/);
    await expectDbError(db.delete(attachments).where(eq(attachments.id, file.id)), /cannot be deleted/);
  });
});

describe("payment receipts", () => {
  it("only Admins attach receipts; the payee and managers see them; they are never removed", async () => {
    const { pm, admin, a, b, project, task } = await setup();
    await updateTaskProgress(a, task.id, { status: "DONE", completionNote: "Designs delivered", completedOn: todayInOperatingZone() });
    await requestApproval(pm, project.id);
    const [{ version }] = await db.select({ version: projects.version }).from(projects).where(eq(projects.id, project.id));
    await approveProject(pm, project.id, { expectedVersion: version });
    const [entry] = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.memberId, a.id));
    const { payment } = await recordPayment(admin, entry.id, { amount: "100.00", method: "MOBILE_MONEY", paidOn: todayInOperatingZone() });

    await expect(uploadAttachment(pm, { kind: "PAYMENT", paymentId: payment.id }, pdf())).rejects.toThrow(PermissionError);
    const receipt = await uploadAttachment(admin, { kind: "PAYMENT", paymentId: payment.id }, pdf("momo"));

    expect((await listPaymentReceipts(a, [payment.id])).get(payment.id)).toHaveLength(1);
    expect((await listPaymentReceipts(pm, [payment.id])).get(payment.id)).toHaveLength(1);
    expect((await listPaymentReceipts(b, [payment.id])).get(payment.id)).toBeUndefined();
    expect(await openAttachment(b, receipt.id)).toBeNull();

    await expect(removeAttachment(admin, receipt.id)).rejects.toThrow(/cannot be removed/);
    await expectDbError(
      withActor(admin, (tx) => tx.update(attachments).set({ removedAt: new Date(), removedBy: admin.id }).where(eq(attachments.id, receipt.id))),
      /cannot be removed/,
    );
  });
});
