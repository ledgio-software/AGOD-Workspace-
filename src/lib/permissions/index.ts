// Server-side authorization rules (design doc section 4). UI hiding is never enough:
// every protected read and mutation calls `can`/`assertCan` on the server, and Postgres
// row-level security (see db/migrations/*_row_level_security.sql) enforces the same rules again.

export type Role = "TEAM_MEMBER" | "PROJECT_MANAGER" | "ADMIN";

export type Actor = { id: string; role: Role };

export type Action =
  | "project.view"
  | "project.create"
  | "project.edit"
  | "project.configureCompensation"
  | "project.requestApproval"
  | "project.approve"
  | "project.reject"
  | "project.reopen"
  | "task.update"
  | "payout.viewOwn"
  | "payout.viewAll"
  | "payment.record"
  | "adjustment.create"
  | "ledger.export"
  | "team.view"
  | "team.manage"
  | "audit.viewAll"
  | "audit.viewProject";

/** Facts about the record being acted on, when the rule depends on it. */
export type ResourceContext = {
  /** The actor is the project owner or has an active assignment on the project. */
  isProjectMember?: boolean;
  /** The task is assigned to the actor. */
  isTaskAssignee?: boolean;
};

const isManager = (actor: Actor) => actor.role === "PROJECT_MANAGER" || actor.role === "ADMIN";
const isAdmin = (actor: Actor) => actor.role === "ADMIN";

const rules: Record<Action, (actor: Actor, resource: ResourceContext) => boolean> = {
  "project.view": (a, r) => isManager(a) || r.isProjectMember === true,
  "project.create": isManager,
  "project.edit": isManager,
  "project.configureCompensation": isManager,
  "project.requestApproval": (a, r) => isManager(a) || r.isProjectMember === true,
  "project.approve": isManager,
  "project.reject": isManager,
  // Decision 5: reopening an approved project is Admin-only.
  "project.reopen": isAdmin,
  // Members update only their own assigned tasks; managers may update any task.
  "task.update": (a, r) => isManager(a) || r.isTaskAssignee === true,
  "payout.viewOwn": () => true,
  "payout.viewAll": isManager,
  // Decision 4: only Admins record manual payments.
  "payment.record": isAdmin,
  "adjustment.create": isAdmin,
  "ledger.export": isManager,
  "team.view": isManager,
  "team.manage": isAdmin,
  "audit.viewAll": isAdmin,
  "audit.viewProject": isManager,
};

export function can(actor: Actor, action: Action, resource: ResourceContext = {}): boolean {
  return rules[action](actor, resource);
}

export class PermissionError extends Error {
  constructor(public readonly action: Action) {
    super(`Not allowed: ${action}`);
    this.name = "PermissionError";
  }
}

export function assertCan(actor: Actor, action: Action, resource: ResourceContext = {}): void {
  if (!can(actor, action, resource)) throw new PermissionError(action);
}
