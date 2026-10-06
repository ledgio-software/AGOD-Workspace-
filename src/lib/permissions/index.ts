// Server-side authorization rules (design doc section 4). UI hiding is never enough:
// every protected read and mutation calls `can`/`assertCan` on the server, and Postgres
// row-level security (see db/migrations/*_row_level_security.sql) enforces the same rules again.

export type Role = "TEAM_MEMBER" | "PROJECT_MANAGER" | "ADMIN";

/** Who is acting, in which company (Phase 22), with their role in that company. */
export type Actor = { id: string; role: Role; orgId: string };

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
  | "audit.viewProject"
  | "project.overrideHealth"
  | "payoutQuestion.raise"
  | "payoutQuestion.review"
  | "payoutQuestion.resolve"
  | "period.view"
  | "period.close"
  | "comment.create"
  | "template.manage"
  | "workload.view"
  | "report.weekly"
  | "finance.view"
  | "finance.manage"
  | "customer.view"
  | "customer.manage"
  | "subscription.view"
  | "subscription.manage"
  | "invoice.view"
  | "invoice.manage"
  | "invoice.recordPayment"
  | "invoice.settings"
  | "google.manage"
  | "company.manage";

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
  // Roadmap 2.2: a PM may replace the calculated health, always with a written reason.
  "project.overrideHealth": isManager,
  // Roadmap 2.8: members question their own payouts; PMs review; Admins settle (adjustments are Admin-only).
  "payoutQuestion.raise": () => true,
  "payoutQuestion.review": isManager,
  "payoutQuestion.resolve": isAdmin,
  // Roadmap 2.9: period close.
  "period.view": isManager,
  "period.close": isAdmin,
  // Roadmap Stage 2: anyone who can see a project can take part in its discussion.
  "comment.create": (a, r) => isManager(a) || r.isProjectMember === true,
  "template.manage": isManager,
  "workload.view": isManager,
  "report.weekly": isManager,
  // Stage 3: profitability, costs and forecasts (PMs and Admins; see docs/DECISIONS.md).
  "finance.view": isManager,
  "finance.manage": isManager,
  // Phase 16: customers and their contacts (PMs and Admins; members see only the client name on their projects).
  "customer.view": isManager,
  "customer.manage": isManager,
  // Phase 17: the service catalogue and customer subscriptions (PMs and Admins).
  "subscription.view": isManager,
  "subscription.manage": isManager,
  // Phase 20: PMs and Admins prepare, issue, send and void invoices; money received from customers
  // and the business details printed on invoices are Admin-only (like decision 4 for payouts).
  "invoice.view": isManager,
  "invoice.manage": isManager,
  "invoice.recordPayment": isAdmin,
  "invoice.settings": isAdmin,
  // Phase 21: connecting or disconnecting the company Google account.
  "google.manage": isAdmin,
  // Phase 22: the company's name and project code prefix.
  "company.manage": isAdmin,
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
