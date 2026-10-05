import { and, eq, inArray } from "drizzle-orm";
import { withActor } from "@/lib/db/actor";
import { projectAssignments, projects, tasks, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { type Actor, assertCan } from "@/lib/permissions";
import { addDays } from "@/modules/notifications/deadlines";

// Workload and capacity (roadmap 2.6): how much open work each active person has, and how the
// estimated hours due in the next 7 days (plus anything overdue) compare with their weekly capacity.

export const PLANNING_WINDOW_DAYS = 7;
const OPEN_PROJECT = ["DRAFT", "PLANNING", "IN_PROGRESS", "PENDING_APPROVAL", "CHANGES_REQUESTED"] as const;

type Person = { id: string; name: string; role: string; weeklyCapacityHours: number };
type OpenTask = { assignedTo: string; projectId: string; status: string; dueDate: string | null; estimateHours: number | null };

export type WorkloadRow = Person & {
  activeProjects: number;
  open: number;
  inProgress: number;
  blocked: number;
  overdue: number;
  dueThisWeek: number;
  unestimated: number;
  openHours: number;
  plannedHours: number;
  /** plannedHours / capacity in percent; null when capacity is 0. */
  loadPercent: number | null;
};

const rank = (r: { loadPercent: number | null; open: number }) => r.loadPercent ?? (r.open > 0 ? Infinity : -1);

export function computeWorkload(people: Person[], openTasks: OpenTask[], projectsByPerson: Map<string, Set<string>>, today: string): WorkloadRow[] {
  const horizon = addDays(today, PLANNING_WINDOW_DAYS - 1);
  return people
    .map((p) => {
      const mine = openTasks.filter((t) => t.assignedTo === p.id);
      const planned = mine.filter((t) => t.dueDate !== null && t.dueDate <= horizon);
      const plannedHours = planned.reduce((s, t) => s + (t.estimateHours ?? 0), 0);
      const projectIds = new Set([...(projectsByPerson.get(p.id) ?? []), ...mine.map((t) => t.projectId)]);
      return {
        ...p,
        activeProjects: projectIds.size,
        open: mine.length,
        inProgress: mine.filter((t) => t.status === "IN_PROGRESS").length,
        blocked: mine.filter((t) => t.status === "BLOCKED").length,
        overdue: mine.filter((t) => t.dueDate !== null && t.dueDate < today).length,
        dueThisWeek: mine.filter((t) => t.dueDate !== null && t.dueDate >= today && t.dueDate <= horizon).length,
        unestimated: mine.filter((t) => t.estimateHours === null).length,
        openHours: mine.reduce((s, t) => s + (t.estimateHours ?? 0), 0),
        plannedHours,
        loadPercent: p.weeklyCapacityHours > 0 ? Math.round((plannedHours / p.weeklyCapacityHours) * 100) : null,
      };
    })
    // Most loaded first; someone with no capacity (e.g. on leave) but open work sorts to the top.
    .sort((a, b) => rank(b) - rank(a) || b.open - a.open || a.name.localeCompare(b.name));
}

export async function getWorkload(actor: Actor) {
  assertCan(actor, "workload.view");
  const today = todayInOperatingZone();
  return withActor(actor, async (tx) => {
    const people = await tx
      .select({ id: users.id, name: users.name, role: users.role, weeklyCapacityHours: users.weeklyCapacityHours })
      .from(users)
      .where(eq(users.active, true));
    const openTasks = await tx
      .select({ assignedTo: tasks.assignedTo, projectId: tasks.projectId, status: tasks.status, dueDate: tasks.dueDate, estimateHours: tasks.estimateHours })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(inArray(tasks.status, ["NOT_STARTED", "IN_PROGRESS", "BLOCKED"]), inArray(projects.status, [...OPEN_PROJECT])));
    const assignments = await tx
      .select({ memberId: projectAssignments.memberId, projectId: projectAssignments.projectId })
      .from(projectAssignments)
      .innerJoin(projects, eq(projects.id, projectAssignments.projectId))
      .where(and(eq(projectAssignments.active, true), inArray(projects.status, [...OPEN_PROJECT])));
    const byPerson = new Map<string, Set<string>>();
    for (const a of assignments) byPerson.set(a.memberId, (byPerson.get(a.memberId) ?? new Set()).add(a.projectId));
    const rows = computeWorkload(
      people,
      openTasks.flatMap((t) => (t.assignedTo ? [{ ...t, assignedTo: t.assignedTo }] : [])),
      byPerson,
      today,
    );
    const unassigned = openTasks.filter((t) => t.assignedTo === null).length;
    return { today, windowDays: PLANNING_WINDOW_DAYS, rows, unassigned };
  });
}
