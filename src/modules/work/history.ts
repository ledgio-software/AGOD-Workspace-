import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withActor } from "@/lib/db/actor";
import {
  adjustments,
  milestones,
  paymentTransactions,
  projectAssignments,
  projects,
  tasks,
  orgMembers,
} from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { type Actor, PermissionError, can } from "@/lib/permissions";
import { ledgerRowsTx, ledgerTotals } from "@/modules/ledger";
import { isTaskOverdue } from "@/modules/projects/rules";

/**
 * Contribution history for one person (roadmap 2.3): projects and roles, completed work, payouts,
 * payments and adjustments. Managers can open anyone's; members only their own. Inactive members
 * keep their full history (design doc section 13).
 */
export async function getContributionHistory(actor: Actor, memberId: string) {
  if (memberId !== actor.id && !can(actor, "team.view")) throw new PermissionError("team.view");
  return withActor(actor, async (tx) => {
    const [member] = await tx
      .select({ id: orgMembers.id, name: orgMembers.name, email: orgMembers.email, role: orgMembers.role, active: orgMembers.active, createdAt: orgMembers.createdAt })
      .from(orgMembers)
      .where(eq(orgMembers.id, memberId));
    if (!member) return null;
    const today = todayInOperatingZone();

    const assignmentRows = await tx
      .select({ assignment: projectAssignments, project: projects })
      .from(projectAssignments)
      .innerJoin(projects, eq(projects.id, projectAssignments.projectId))
      .where(eq(projectAssignments.memberId, memberId))
      .orderBy(desc(projects.createdAt));

    const taskRows = await tx
      .select({ task: tasks, projectCode: projects.code, projectName: projects.name })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.assignedTo, memberId))
      .orderBy(desc(tasks.completedAt), desc(tasks.updatedAt));
    const allTasks = taskRows.map((r) => ({ ...r.task, projectCode: r.projectCode, projectName: r.projectName }));
    const openTasks = allTasks.filter((t) => t.status !== "DONE" && t.status !== "WAIVED");

    const projectIds = [...new Set([...assignmentRows.map((r) => r.project.id), ...allTasks.map((t) => t.projectId)])];
    const completedMilestones = projectIds.length
      ? await tx
          .select({ milestone: milestones, projectCode: projects.code })
          .from(milestones)
          .innerJoin(projects, eq(projects.id, milestones.projectId))
          .where(and(inArray(milestones.projectId, projectIds), eq(milestones.status, "COMPLETED")))
          .orderBy(asc(projects.code), asc(milestones.sequence))
      : [];

    const ledger = await ledgerRowsTx(tx, { memberId });
    const entryIds = ledger.map((r) => r.id);
    const codeOf = new Map(ledger.map((r) => [r.id, r.projectCode]));
    const [payments, adjustmentRows] = entryIds.length
      ? await Promise.all([
          tx.select().from(paymentTransactions).where(inArray(paymentTransactions.ledgerEntryId, entryIds)).orderBy(desc(paymentTransactions.paidAt)),
          tx.select().from(adjustments).where(inArray(adjustments.ledgerEntryId, entryIds)).orderBy(desc(adjustments.createdAt)),
        ])
      : [[], []];

    // Projects: one row per project, with every role held there (current and past).
    const byProject = new Map<string, { project: typeof projects.$inferSelect; roles: string[]; active: boolean }>();
    for (const { assignment, project } of assignmentRows) {
      const entry = byProject.get(project.id) ?? { project, roles: [], active: false };
      entry.roles.push(assignment.active ? assignment.roleOnProject : `${assignment.roleOnProject} (removed)`);
      entry.active ||= assignment.active;
      byProject.set(project.id, entry);
    }

    return {
      member,
      workload: {
        open: openTasks.length,
        inProgress: openTasks.filter((t) => t.status === "IN_PROGRESS").length,
        blocked: openTasks.filter((t) => t.status === "BLOCKED").length,
        overdue: openTasks.filter((t) => isTaskOverdue(t, today)).length,
        completed: allTasks.filter((t) => t.status === "DONE").length,
        activeProjects: [...byProject.values()].filter((p) => p.active && !["COMPLETED", "CANCELLED"].includes(p.project.status)).length,
      },
      projects: [...byProject.values()].map(({ project, roles }) => ({
        id: project.id,
        code: project.code,
        name: project.name,
        status: project.status,
        roles,
      })),
      openTasks: openTasks.map((t) => ({ ...t, overdue: isTaskOverdue(t, today) })),
      completedTasks: allTasks.filter((t) => t.status === "DONE"),
      completedMilestones: completedMilestones.map((m) => ({ ...m.milestone, projectCode: m.projectCode })),
      payouts: ledger,
      totals: ledgerTotals(ledger),
      payments: payments.map((p) => ({ ...p, projectCode: codeOf.get(p.ledgerEntryId) ?? "" })),
      adjustments: adjustmentRows.map((a) => ({ ...a, projectCode: codeOf.get(a.ledgerEntryId) ?? "" })),
    };
  });
}
