// Creates three representative pilot projects through the real services, so every amount, status
// change and audit event is genuine (design doc Phase 5). Staging or local only.
//
//   PILOT_TARGET=staging DATABASE_URL=... npm run pilot:seed
//
// Acts as the first active Admin in the database (who may also act as PM). Pilot recipients are
// created as Team Members without passwords; an Admin can give them one with "Reset password".
import { config } from "dotenv";
import { and, eq, like, sql } from "drizzle-orm";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  if (process.env.NODE_ENV === "production" || !["staging", "local"].includes(process.env.PILOT_TARGET ?? "")) {
    throw new Error("Refusing to run: set PILOT_TARGET=staging or PILOT_TARGET=local (never production).");
  }
  // Imported after the guard so nothing connects before it passes.
  const { db } = await import("../src/lib/db");
  const { payoutLedgerEntries, projects, tasks, users } = await import("../src/lib/db/schema");
  const { approveProject, rejectProject, requestApproval } = await import("../src/modules/approvals");
  const { createAdjustment, recordPayment } = await import("../src/modules/payments");
  const { changeProjectStatus, createProject } = await import("../src/modules/projects");
  const { addAssignment, createMilestone } = await import("../src/modules/projects/team");
  const { createTask, updateTaskProgress, waiveTask } = await import("../src/modules/tasks");
  type Actor = { id: string; role: "ADMIN" | "PROJECT_MANAGER" | "TEAM_MEMBER" };

  const [adminRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.active, true)))
    .limit(1);
  if (!adminRow) throw new Error("No active Admin found. Create one first.");
  const admin: Actor = { id: adminRow.id, role: "ADMIN" };

  const [existing] = await db.select({ id: projects.id }).from(projects).where(like(projects.name, "[Pilot]%")).limit(1);
  if (existing) {
    console.log("Pilot projects already exist; nothing to do.");
    return;
  }

  async function member(name: string, email: string): Promise<Actor> {
    const [found] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email));
    if (found) return { id: found.id, role: "TEAM_MEMBER" };
    const [created] = await db.insert(users).values({ name, email, role: "TEAM_MEMBER", emailVerified: true }).returning({ id: users.id });
    return { id: created.id, role: "TEAM_MEMBER" };
  }
  const ama = await member("Pilot – Ama Mensah", "pilot.ama@agod.test");
  const kofi = await member("Pilot – Kofi Boateng", "pilot.kofi@agod.test");
  const efua = await member("Pilot – Efua Owusu", "pilot.efua@agod.test");

  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const version = async (id: string) => (await db.select({ v: projects.version }).from(projects).where(eq(projects.id, id)))[0].v;
  const entryFor = async (projectId: string, memberId: string) =>
    (await db.select().from(payoutLedgerEntries).where(and(eq(payoutLedgerEntries.projectId, projectId), eq(payoutLedgerEntries.memberId, memberId))))[0];
  const start = async (id: string) => {
    await changeProjectStatus(admin, id, { to: "PLANNING" });
    await changeProjectStatus(admin, id, { to: "IN_PROGRESS" });
  };

  // 1. External, percentage split: blocked task, rejection, approval, partial payment, increase.
  const payroll = await createProject(admin, {
    name: "[Pilot] Ledgio Payroll Module",
    description: "Payslips and statutory deductions for Ledgio.",
    clientType: "EXTERNAL",
    clientName: "Ledgio",
    totalValue: "12500.00",
    splitMode: "PERCENTAGE",
    projectOwnerId: admin.id,
    startDate: daysAgo(30),
    targetDate: daysAgo(-14),
  });
  await addAssignment(admin, payroll.id, { memberId: ama.id, roleOnProject: "Backend developer", split: "50", rationale: "API and payroll rules" });
  await addAssignment(admin, payroll.id, { memberId: kofi.id, roleOnProject: "Frontend developer", split: "30" });
  await addAssignment(admin, payroll.id, { memberId: efua.id, roleOnProject: "QA", split: "20" });
  await start(payroll.id);
  const m1 = await createMilestone(admin, payroll.id, { title: "Payroll engine" });
  const api = await createTask(admin, payroll.id, { title: "Payslip API", assignedTo: ama.id, milestoneId: m1.id });
  const ui = await createTask(admin, payroll.id, { title: "Payslip screens", assignedTo: kofi.id, milestoneId: m1.id });
  const qa = await createTask(admin, payroll.id, { title: "Regression tests", assignedTo: efua.id });
  await updateTaskProgress(ama, api.id, { status: "BLOCKED", blockedReason: "Tax table for 2026 not published", blockedNeeds: "GRA tax bands from the client" });
  await updateTaskProgress(ama, api.id, { status: "DONE", completionNote: "API live with 2026 tax bands", completedOn: today });
  await updateTaskProgress(kofi, ui.id, { status: "DONE", completionNote: "Screens approved by client", completedOn: today });
  await updateTaskProgress(efua, qa.id, { status: "DONE", completionNote: "120 cases passing", completedOn: today });
  await requestApproval(ama, payroll.id, "All work delivered");
  await rejectProject(admin, payroll.id, "Attach the client's sign-off email to the QA task");
  await requestApproval(efua, payroll.id, "Sign-off attached");
  await approveProject(admin, payroll.id, { expectedVersion: await version(payroll.id) });
  await recordPayment(admin, (await entryFor(payroll.id, ama.id)).id, { amount: "3000.00", method: "MOBILE_MONEY", reference: "PILOT-MOMO-001", paidOn: today });
  await createAdjustment(admin, (await entryFor(payroll.id, efua.id)).id, { type: "INCREASE", amount: "250.00", reason: "Weekend regression run requested by client" });
  await recordPayment(admin, (await entryFor(payroll.id, kofi.id)).id, { amount: "3750.00", method: "BANK_TRANSFER", reference: "PILOT-BANK-001", paidOn: today });

  // 2. Internal, fixed amounts with an unallocated remainder: waived task, decrease, fully paid.
  const site = await createProject(admin, {
    name: "[Pilot] AGOD Website Refresh",
    clientType: "INTERNAL",
    totalValue: "4000.00",
    splitMode: "FIXED_AMOUNT",
    projectOwnerId: admin.id,
  });
  await addAssignment(admin, site.id, { memberId: kofi.id, roleOnProject: "Frontend developer", split: "2000.00" });
  await addAssignment(admin, site.id, { memberId: ama.id, roleOnProject: "Content and SEO", split: "1500.00" });
  await start(site.id);
  const pages = await createTask(admin, site.id, { title: "New landing pages", assignedTo: kofi.id });
  const blog = await createTask(admin, site.id, { title: "Blog migration", assignedTo: ama.id });
  await updateTaskProgress(kofi, pages.id, { status: "DONE", completionNote: "Deployed", completedOn: today });
  await waiveTask(admin, blog.id, "Blog moved to Medium instead");
  await requestApproval(admin, site.id);
  await approveProject(admin, site.id, { expectedVersion: await version(site.id) });
  const amaSite = await entryFor(site.id, ama.id);
  await createAdjustment(admin, amaSite.id, { type: "DECREASE", amount: "300.00", reason: "Blog migration dropped from scope" });
  await recordPayment(admin, amaSite.id, { amount: "1200.00", method: "CASH", paidOn: today });
  await recordPayment(admin, (await entryFor(site.id, kofi.id)).id, { amount: "2000.00", method: "MOBILE_MONEY", reference: "PILOT-MOMO-002", paidOn: today });

  // 3. In progress: a blocked task and an overdue task for the dashboard.
  const spike = await createProject(admin, {
    name: "[Pilot] Mobile Money Integration Spike",
    clientType: "EXTERNAL",
    clientName: "Ledgio",
    totalValue: "8000.00",
    splitMode: "PERCENTAGE",
    projectOwnerId: admin.id,
    targetDate: daysAgo(-5),
  });
  await addAssignment(admin, spike.id, { memberId: efua.id, roleOnProject: "Integration engineer", split: "60" });
  await addAssignment(admin, spike.id, { memberId: ama.id, roleOnProject: "Reviewer", split: "40" });
  await start(spike.id);
  const sandbox = await createTask(admin, spike.id, { title: "Sandbox credentials", assignedTo: efua.id });
  await createTask(admin, spike.id, { title: "Callback handler", assignedTo: ama.id, dueDate: daysAgo(2) });
  await updateTaskProgress(efua, sandbox.id, { status: "BLOCKED", blockedReason: "Provider has not issued sandbox keys", blockedNeeds: "Follow-up call with the provider" });

  const count = await db.select({ n: sql<number>`count(*)::int` }).from(tasks);
  console.log(`Pilot data created: 3 projects, ${count[0].n} tasks in the database.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
