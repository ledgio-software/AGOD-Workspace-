import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { payoutLedgerEntries, projects, users } from "@/lib/db/schema";
import { PermissionError } from "@/lib/permissions";
import { approveProject, requestApproval } from "@/modules/approvals";
import { listAuditEvents } from "@/modules/audit/query";
import { createAdjustment, recordPayment } from "@/modules/payments";
import { changeProjectStatus, createProject } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { reconcileWithLedger } from "@/modules/reports/reconcile-ledger";
import { getProjectStatement } from "@/modules/reports/statement";
import { createUser, db } from "./fixtures";

const today = new Date().toISOString().slice(0, 10);

/** Approved GHS 1,000.00 project split 60/40; member A partly paid, member B adjusted up. */
async function pilot() {
  const pm = await createUser("PROJECT_MANAGER");
  const admin = await createUser("ADMIN");
  const a = await createUser("TEAM_MEMBER");
  const b = await createUser("TEAM_MEMBER");
  const project = await createProject(pm, {
    name: `Report ${crypto.randomUUID().slice(0, 6)}`,
    clientType: "INTERNAL",
    totalValue: "1000",
    splitMode: "PERCENTAGE",
    projectOwnerId: pm.id,
  });
  await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Dev", split: "60" });
  await addAssignment(pm, project.id, { memberId: b.id, roleOnProject: "QA", split: "40" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  await requestApproval(pm, project.id);
  const [{ version, code }] = await db.select().from(projects).where(eq(projects.id, project.id));
  await approveProject(pm, project.id, { expectedVersion: version });
  const entries = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id));
  const entryOf = (id: string) => entries.find((e) => e.memberId === id)!;
  await recordPayment(admin, entryOf(a.id).id, { amount: "100.00", method: "CASH", paidOn: today });
  await createAdjustment(admin, entryOf(b.id).id, { type: "INCREASE", amount: "50.00", reason: "Extra QA round" });
  const email = async (id: string) => (await db.select({ e: users.email }).from(users).where(eq(users.id, id)))[0].e;
  return { pm, admin, a, b, project, code, emailA: await email(a.id), emailB: await email(b.id) };
}

describe("project statement", () => {
  it("explains every amount and passes all arithmetic checks", async () => {
    const { pm, project } = await pilot();
    const statement = (await getProjectStatement(pm, project.id))!;
    expect(statement.snapshots).toHaveLength(1);
    const [snap] = statement.snapshots;
    expect(snap.allocatedMinor).toBe(100_000);
    const owed = snap.recipients.map((r) => r.balance!.effectiveOwedMinor).sort((x, y) => x - y);
    expect(owed).toEqual([45_000, 60_000]);
    expect(statement.checks.length).toBeGreaterThanOrEqual(5);
    expect(statement.checks.every((c) => c.ok)).toBe(true);
    const actions = statement.timeline.map((t) => t.action);
    expect(actions).toContain("project.approved");
  });

  it("shows a member only their own line and skips the whole-project check", async () => {
    const { a, project } = await pilot();
    const statement = (await getProjectStatement(a, project.id))!;
    const recipients = statement.snapshots.flatMap((s) => s.recipients);
    expect(recipients.map((r) => r.line.memberId)).toEqual([a.id]);
    expect(statement.checks.some((c) => c.label.includes("project value"))).toBe(false);
  });
});

describe("reconciliation against the ledger", () => {
  it("matches, flags mismatches and reports rows missing on either side", async () => {
    const { admin, code, emailA, emailB } = await pilot();
    const sheet = [
      "project_code,recipient_email,expected_owed,expected_paid",
      `${code},${emailA},600.00,100.00`,
      `${code},${emailB},400.00,0`,
      `${code},nobody@agod.test,10.00,`,
    ].join("\n");
    const result = await reconcileWithLedger(admin, sheet);
    expect(result.errors).toEqual([]);
    expect(result.matched.map((m) => m.key)).toContain(`${code} / ${emailA}`);
    const mismatch = result.mismatched.find((m) => m.key === `${code} / ${emailB}`)!;
    expect(mismatch.owedMinor).toBe(45_000);
    expect(mismatch.expectedOwedMinor).toBe(40_000);
    expect(result.missingInSystem.map((r) => r.email)).toEqual(["nobody@agod.test"]);
  });

  it("is refused for team members", async () => {
    const { a } = await pilot();
    await expect(reconcileWithLedger(a, "project_code,recipient_email,expected_owed")).rejects.toThrow(PermissionError);
  });
});

describe("audit log", () => {
  it("lets a manager reproduce the project's status transitions", async () => {
    const { pm, project } = await pilot();
    const { events } = await listAuditEvents(pm, { projectId: project.id });
    const actions = events.map((e) => e.action);
    for (const expected of ["project.created", "project.approved", "payment.recorded", "adjustment.created"]) {
      expect(actions).toContain(expected);
    }
  });

  it("is refused for team members", async () => {
    const { a, project } = await pilot();
    await expect(listAuditEvents(a, { projectId: project.id })).rejects.toThrow(PermissionError);
  });
});
