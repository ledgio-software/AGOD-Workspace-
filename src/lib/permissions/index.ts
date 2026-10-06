// Server-side authorization rules (design doc section 4). UI hiding is never enough:
// every protected read and mutation calls `can`/`assertCan` on the server, and Postgres
// row-level security (see db/migrations/*_row_level_security.sql) enforces the same rules again.

export type Role = "TEAM_MEMBER" | "PROJECT_MANAGER" | "ADMIN";

/**
 * Who is acting, in which company (Phase 22), with their role in that company. Phase 28: a
 * company-made role keeps its base `role` (what the database allows) and lists the permission
 * groups it keeps in `permissions`; null or absent means the full base role.
 */
export type Actor = { id: string; role: Role; orgId: string; permissions?: readonly PermissionKey[] | null };

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

// Phase 28: companies make their own roles by starting from Team Member, Project Manager or Admin
// and switching permission groups off. A role can only narrow its base role (row-level security
// still enforces the base role), never widen it.

export type PermissionKey =
  | "projects.manage"
  | "projects.approve"
  | "projects.reopen"
  | "payouts.view"
  | "payouts.pay"
  | "team.view"
  | "team.manage"
  | "finance"
  | "clients"
  | "invoices"
  | "invoices.payments"
  | "company";

export type PermissionGroup = { key: PermissionKey; label: string; description: string; base: Role; actions: readonly Action[]; money?: boolean };

/** Every manager- or Admin-level action belongs to exactly one group (checked by the unit tests). */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    key: "projects.manage",
    label: "Create and edit projects",
    description: "New projects, details, team and splits, milestones, any task, health and templates.",
    base: "PROJECT_MANAGER",
    actions: ["project.create", "project.edit", "project.configureCompensation", "project.overrideHealth", "template.manage", "task.update"],
  },
  { key: "projects.approve", label: "Approve finished projects", description: "Approve (which creates the payouts) or send back for changes.", base: "PROJECT_MANAGER", actions: ["project.approve", "project.reject"], money: true },
  { key: "projects.reopen", label: "Reopen approved projects", description: "Undo an approval before anyone is paid.", base: "ADMIN", actions: ["project.reopen"], money: true },
  {
    key: "payouts.view",
    label: "See everyone's payouts",
    description: "The ledger and its export, month close checklist, and payout questions.",
    base: "PROJECT_MANAGER",
    actions: ["payout.viewAll", "ledger.export", "period.view", "payoutQuestion.review"],
    money: true,
  },
  {
    key: "payouts.pay",
    label: "Pay the team",
    description: "Record payments and adjustments, settle payout questions, close the month.",
    base: "ADMIN",
    actions: ["payment.record", "adjustment.create", "payoutQuestion.resolve", "period.close"],
    money: true,
  },
  { key: "team.view", label: "See the team", description: "The team list, workload and weekly summary.", base: "PROJECT_MANAGER", actions: ["team.view", "workload.view", "report.weekly"] },
  { key: "team.manage", label: "Manage people and roles", description: "Add people, change roles and job titles, deactivate, reset passwords.", base: "ADMIN", actions: ["team.manage"] },
  { key: "finance", label: "Profitability and costs", description: "Profit reports, forecasts, cost budgets and project costs.", base: "PROJECT_MANAGER", actions: ["finance.view", "finance.manage"], money: true },
  {
    key: "clients",
    label: "Customers and subscriptions",
    description: "Customers, contacts, services and subscriptions.",
    base: "PROJECT_MANAGER",
    actions: ["customer.view", "customer.manage", "subscription.view", "subscription.manage"],
  },
  { key: "invoices", label: "Invoices", description: "Create, send and void invoices.", base: "PROJECT_MANAGER", actions: ["invoice.view", "invoice.manage"], money: true },
  { key: "invoices.payments", label: "Customer payments", description: "Record money received from customers; invoice settings.", base: "ADMIN", actions: ["invoice.recordPayment", "invoice.settings"], money: true },
  { key: "company", label: "Company settings", description: "Company details, Google and GitHub connections, the full audit log.", base: "ADMIN", actions: ["company.manage", "google.manage", "audit.viewAll"] },
];

const rank: Record<Role, number> = { TEAM_MEMBER: 0, PROJECT_MANAGER: 1, ADMIN: 2 };

/** The groups a base role has in full. */
export function groupsOf(role: Role): PermissionKey[] {
  return PERMISSION_GROUPS.filter((g) => rank[g.base] <= rank[role]).map((g) => g.key);
}

/** The groups an actor actually has: their role's list, limited to what the base role allows. */
export function effectiveGroups(actor: Actor): PermissionKey[] {
  const full = groupsOf(actor.role);
  return actor.permissions ? full.filter((k) => actor.permissions!.includes(k)) : full;
}

const groupOfAction = new Map<Action, PermissionGroup>(PERMISSION_GROUPS.flatMap((g) => g.actions.map((a) => [a, g] as const)));

// What someone may still do when the group is switched off: their own tasks.
const ownWork: Partial<Record<Action, (resource: ResourceContext) => boolean>> = {
  "task.update": (r) => r.isTaskAssignee === true,
};

export function can(actor: Actor, action: Action, resource: ResourceContext = {}): boolean {
  if (!rules[action](actor, resource)) return false;
  const group = groupOfAction.get(action);
  if (!group || !actor.permissions || actor.permissions.includes(group.key)) return true;
  return ownWork[action]?.(resource) ?? false;
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
