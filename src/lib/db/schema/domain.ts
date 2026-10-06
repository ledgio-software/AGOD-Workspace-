import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations } from "./orgs";

// Domain tables from the design document, section 6.
// Money is always integer minor units (pesewas) + ISO currency code.
// Financial history is never cascade-deleted: every foreign key uses RESTRICT.

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());
const money = (name: string) => bigint(name, { mode: "number" });
const currency = () => char("currency", { length: 3 }).notNull().default("GHS");
// Phase 22: the company a row belongs to. Filled from the signed-in person's current company
// (app.org_id, set by withActor); row-level security keeps every company's rows apart.
const orgRef = () =>
  uuid("organization_id")
    .notNull()
    .default(sql`app_org_id()`)
    .references(() => organizations.id, { onDelete: "restrict" });
const userRef = (name: string) => uuid(name).references(() => users.id, { onDelete: "restrict" });

export const clientType = pgEnum("client_type", ["INTERNAL", "EXTERNAL"]);
export const projectStatus = pgEnum("project_status", [
  "DRAFT",
  "PLANNING",
  "IN_PROGRESS",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "COMPLETED",
  "CANCELLED",
]);
export const splitType = pgEnum("split_type", ["PERCENTAGE", "FIXED_AMOUNT"]);
export const milestoneStatus = pgEnum("milestone_status", [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
]);
export const taskStatus = pgEnum("task_status", [
  "NOT_STARTED",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
  "WAIVED",
  // Roadmap 2.5: a pull request is open (In review) or merged and waiting for PM verification (Ready for QA).
  "IN_REVIEW",
  "READY_FOR_QA",
]);
export const payoutStatus = pgEnum("payout_status", [
  "OWED",
  "PARTIALLY_PAID",
  "PAID",
  "DISPUTED",
  "VOIDED",
]);
export const paymentMethod = pgEnum("payment_method", [
  "MOBILE_MONEY",
  "BANK_TRANSFER",
  "CASH",
  "OTHER",
]);
export const adjustmentType = pgEnum("adjustment_type", [
  "INCREASE",
  "DECREASE",
  "WRITE_OFF",
  "VOID",
]);
// Stage 3: project types for revenue/profit by type (matches the starter templates).
export const projectCategory = pgEnum("project_category", [
  "DISCOVERY",
  "WEBSITE",
  "MOBILE_APP",
  "AI_INTEGRATION",
  "INTERNAL_PRODUCT",
  "MAINTENANCE",
  "OTHER",
]);
export const costCategory = pgEnum("cost_category", [
  "SOFTWARE",
  "HOSTING",
  "HARDWARE",
  "SUBCONTRACTOR",
  "TRAVEL",
  "MARKETING",
  "OTHER",
]);
export const projectHealthStatus = pgEnum("project_health", ["ON_TRACK", "AT_RISK", "BLOCKED", "OVERDUE"]);
export const payoutQuestionStatus = pgEnum("payout_question_status", ["OPEN", "AWAITING_ADMIN", "RESOLVED"]);

// Phase 16 (customers): one record per client, with contacts. Projects link to it.
export const customerType = pgEnum("customer_type", ["COMPANY", "PERSON", "PARTNER", "OTHER"]);
export const customerStatus = pgEnum("customer_status", ["PROSPECT", "ACTIVE", "PAUSED", "CHURNED", "ARCHIVED"]);
export const contactChannel = pgEnum("contact_channel", ["EMAIL", "PHONE", "WHATSAPP", "OTHER"]);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    name: text("name").notNull(),
    type: customerType("type").notNull().default("COMPANY"),
    status: customerStatus("status").notNull().default("ACTIVE"),
    ownerId: userRef("owner_id").notNull(),
    notes: text("notes"),
    // Optional reference in another system (e.g. the accounting system's customer number).
    externalReference: text("external_reference"),
    createdBy: userRef("created_by").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    // One customer per name (case and surrounding spaces ignored): prevents duplicates.
    uniqueIndex("customers_name_unique").on(t.organizationId, sql`lower(btrim(${t.name}))`),
    check("customers_name_not_blank", sql`length(btrim(${t.name})) >= 2`),
    check("customers_archived_matches_status", sql`(${t.status} = 'ARCHIVED') = (${t.archivedAt} IS NOT NULL)`),
  ],
);

export const customerContacts = pgTable(
  "customer_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    role: text("role"),
    email: text("email"),
    phone: text("phone"),
    preferredChannel: contactChannel("preferred_channel").notNull().default("EMAIL"),
    isPrimary: boolean("is_primary").notNull().default(false),
    isBilling: boolean("is_billing").notNull().default(false),
    // Contacts are removed by deactivating them, so history stays readable.
    active: boolean("active").notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("customer_contacts_customer_idx").on(t.customerId),
    check("customer_contacts_reachable", sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`),
    // At most one active primary contact per customer.
    uniqueIndex("customer_contacts_one_primary").on(t.customerId).where(sql`${t.isPrimary} AND ${t.active}`),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    clientType: clientType("client_type").notNull(),
    clientName: text("client_name"),
    // External projects belong to a customer; client_name keeps a copy of its name for display and reports.
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),
    totalValueMinor: money("total_value_minor").notNull(),
    currency: currency(),
    // Decision 3: one split mode per project.
    splitMode: splitType("split_mode").notNull().default("PERCENTAGE"),
    // Percentage mode: the share AGOD keeps (basis points); team splits total the rest. 0 = none.
    agodShareBasisPoints: integer("agod_share_basis_points").notNull().default(0),
    status: projectStatus("status").notNull().default("DRAFT"),
    projectOwnerId: userRef("project_owner_id").notNull(),
    startDate: date("start_date"),
    targetDate: date("target_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: userRef("created_by").notNull(),
    approvedBy: userRef("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // A PM's manual health status, which replaces the calculated one until cleared (roadmap 2.2).
    healthOverride: projectHealthStatus("health_override"),
    healthOverrideReason: text("health_override_reason"),
    healthOverrideBy: userRef("health_override_by"),
    healthOverrideAt: timestamp("health_override_at", { withTimezone: true }),
    // GitHub repository ("owner/name") whose issues, pull requests and deployments relate to this project.
    githubRepo: text("github_repo"),
    // Stage 3 (profitability): the project type, and the budget for costs other than contributor payouts.
    category: projectCategory("category").notNull().default("OTHER"),
    costBudgetMinor: money("cost_budget_minor").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("projects_org_code_unique").on(t.organizationId, t.code),
    check("projects_total_value_non_negative", sql`${t.totalValueMinor} >= 0`),
    check("projects_cost_budget_non_negative", sql`${t.costBudgetMinor} >= 0`),
    check("projects_customer_matches_client_type", sql`(${t.clientType} = 'EXTERNAL') = (${t.customerId} IS NOT NULL)`),
    index("projects_customer_idx").on(t.customerId),
    check(
      "projects_agod_share_valid",
      sql`${t.agodShareBasisPoints} BETWEEN 0 AND 10000 AND (${t.splitMode} = 'PERCENTAGE' OR ${t.agodShareBasisPoints} = 0)`,
    ),
    check("projects_github_repo_format", sql`${t.githubRepo} IS NULL OR ${t.githubRepo} ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'`),
    check(
      "projects_health_override_has_reason",
      sql`(${t.healthOverride} IS NULL AND ${t.healthOverrideReason} IS NULL)
       OR (${t.healthOverride} IS NOT NULL AND length(trim(coalesce(${t.healthOverrideReason}, ''))) >= 3 AND ${t.healthOverrideBy} IS NOT NULL)`,
    ),
    index("projects_owner_idx").on(t.projectOwnerId),
    index("projects_status_idx").on(t.status),
  ],
);

export const projectAssignments = pgTable(
  "project_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    memberId: userRef("member_id").notNull(),
    roleOnProject: text("role_on_project").notNull(),
    splitType: splitType("split_type").notNull(),
    // PERCENTAGE: basis points (10000 = 100%). FIXED_AMOUNT: minor units.
    splitBasisPoints: integer("split_basis_points"),
    splitAmountMinor: money("split_amount_minor"),
    rationale: text("rationale"),
    active: boolean("active").notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    check(
      "project_assignments_split_value_matches_type",
      sql`(${t.splitType} = 'PERCENTAGE' AND ${t.splitBasisPoints} BETWEEN 0 AND 10000 AND ${t.splitAmountMinor} IS NULL)
       OR (${t.splitType} = 'FIXED_AMOUNT' AND ${t.splitAmountMinor} >= 0 AND ${t.splitBasisPoints} IS NULL)`,
    ),
    uniqueIndex("project_assignments_active_unique")
      .on(t.projectId, t.memberId, t.roleOnProject)
      .where(sql`${t.active}`),
    index("project_assignments_member_idx").on(t.memberId),
  ],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    sequence: integer("sequence").notNull(),
    dueDate: date("due_date"),
    status: milestoneStatus("status").notNull().default("NOT_STARTED"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex("milestones_project_sequence_unique").on(t.projectId, t.sequence)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "restrict" }),
    // Per-project task number, assigned by a database trigger; with the project code it forms the
    // task key used in branch names and pull requests, e.g. AGOD-2026-005-T3.
    number: integer("number").notNull().default(0),
    title: text("title").notNull(),
    description: text("description"),
    assignedTo: userRef("assigned_to"),
    // Project progress counts required tasks only.
    required: boolean("required").notNull().default(true),
    status: taskStatus("status").notNull().default("NOT_STARTED"),
    dueDate: date("due_date"),
    // Planning estimate in whole hours (roadmap 2.6); optional.
    estimateHours: integer("estimate_hours"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: userRef("completed_by"),
    completionNote: text("completion_note"),
    evidenceUrl: text("evidence_url"),
    blockedReason: text("blocked_reason"),
    blockedNeeds: text("blocked_needs"),
    waivedReason: text("waived_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("tasks_project_number_unique").on(t.projectId, t.number),
    check("tasks_estimate_range", sql`${t.estimateHours} IS NULL OR ${t.estimateHours} BETWEEN 1 AND 999`),
    check(
      "tasks_done_requires_note",
      sql`${t.status} <> 'DONE' OR (${t.completionNote} IS NOT NULL AND ${t.completedAt} IS NOT NULL)`,
    ),
    check(
      "tasks_blocked_requires_reason",
      sql`${t.status} <> 'BLOCKED' OR (${t.blockedReason} IS NOT NULL AND ${t.blockedNeeds} IS NOT NULL)`,
    ),
    check("tasks_waived_requires_reason", sql`${t.status} <> 'WAIVED' OR ${t.waivedReason} IS NOT NULL`),
    index("tasks_project_idx").on(t.projectId),
    index("tasks_assigned_to_idx").on(t.assignedTo),
  ],
);

export const compensationSnapshots = pgTable(
  "compensation_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    // 1 for the first approval; a reopened and re-approved project gets 2, 3, ...
    // Earlier snapshots stay as history; their ledger entries are voided.
    sequence: integer("sequence").notNull().default(1),
    projectTotalValueMinor: money("project_total_value_minor").notNull(),
    currency: currency(),
    splitMode: splitType("split_mode").notNull(),
    // What AGOD keeps from this approval (version 2+): the share percentage and the amount.
    agodShareBasisPoints: integer("agod_share_basis_points").notNull().default(0),
    agodShareMinor: money("agod_share_minor").notNull().default(0),
    calculationVersion: integer("calculation_version").notNull(),
    calculationNotes: text("calculation_notes"),
    createdBy: userRef("created_by").notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("compensation_snapshots_project_sequence_unique").on(t.projectId, t.sequence)],
);

export const compensationSnapshotLines = pgTable(
  "compensation_snapshot_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => compensationSnapshots.id, { onDelete: "restrict" }),
    memberId: userRef("member_id").notNull(),
    roleOnProject: text("role_on_project").notNull(),
    sourceAssignmentId: uuid("source_assignment_id")
      .notNull()
      .references(() => projectAssignments.id, { onDelete: "restrict" }),
    splitType: splitType("split_type").notNull(),
    splitBasisPoints: integer("split_basis_points"),
    splitAmountMinor: money("split_amount_minor"),
    amountOwedMinor: money("amount_owed_minor").notNull(),
    currency: currency(),
    rationale: text("rationale"),
    createdAt,
  },
  (t) => [
    check("snapshot_lines_amount_non_negative", sql`${t.amountOwedMinor} >= 0`),
    index("snapshot_lines_member_idx").on(t.memberId),
  ],
);

export const payoutLedgerEntries = pgTable(
  "payout_ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    // One ledger entry per snapshot line: retries cannot duplicate payouts.
    snapshotLineId: uuid("snapshot_line_id")
      .notNull()
      .unique()
      .references(() => compensationSnapshotLines.id, { onDelete: "restrict" }),
    memberId: userRef("member_id").notNull(),
    amountOwedMinor: money("amount_owed_minor").notNull(),
    currency: currency(),
    status: payoutStatus("status").notNull().default("OWED"),
    approvedBy: userRef("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("ledger_amount_non_negative", sql`${t.amountOwedMinor} >= 0`),
    index("ledger_member_idx").on(t.memberId),
    index("ledger_project_idx").on(t.projectId),
  ],
);

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => payoutLedgerEntries.id, { onDelete: "restrict" }),
    amountMinor: money("amount_minor").notNull(),
    currency: currency(),
    method: paymentMethod("method").notNull(),
    reference: text("reference"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    recordedBy: userRef("recorded_by").notNull(),
    evidenceFilePath: text("evidence_file_path"),
    notes: text("notes"),
    createdAt,
  },
  (t) => [
    check("payments_amount_positive", sql`${t.amountMinor} > 0`),
    index("payments_ledger_idx").on(t.ledgerEntryId),
  ],
);

export const adjustments = pgTable(
  "adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => payoutLedgerEntries.id, { onDelete: "restrict" }),
    type: adjustmentType("type").notNull(),
    amountMinor: money("amount_minor").notNull(),
    reason: text("reason").notNull(),
    createdBy: userRef("created_by").notNull(),
    approvedBy: userRef("approved_by"),
    createdAt,
  },
  (t) => [
    check("adjustments_amount_non_negative", sql`${t.amountMinor} >= 0`),
    index("adjustments_ledger_idx").on(t.ledgerEntryId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    actorId: userRef("actor_id"),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    // For records belonging to a project (tasks, assignments, ...), lets PMs see project-scoped history.
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    reason: text("reason"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    createdAt,
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_project_idx").on(t.projectId),
    index("audit_actor_idx").on(t.actorId),
    index("audit_created_at_idx").on(t.createdAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    recipientId: userRef("recipient_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    // Set for generated alerts (e.g. "task.overdue:<task>:<due date>") so each is sent once.
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true }),
    // Phase 19: when it went out in the daily email (each notification is emailed at most once).
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index("notifications_recipient_idx").on(t.recipientId, t.readAt),
    uniqueIndex("notifications_dedupe_idx").on(t.recipientId, t.dedupeKey).where(sql`${t.dedupeKey} IS NOT NULL`),
  ],
);

// A member's question about one of their payouts (roadmap 2.8). The ledger is never edited:
// a PM reviews it, and only an Admin records an adjustment, which is linked here.
export const payoutQuestions = pgTable(
  "payout_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => payoutLedgerEntries.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    raisedBy: userRef("raised_by").notNull(),
    question: text("question").notNull(),
    status: payoutQuestionStatus("status").notNull().default("OPEN"),
    reviewNote: text("review_note"),
    reviewedBy: userRef("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolution: text("resolution"),
    resolvedBy: userRef("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    adjustmentId: uuid("adjustment_id").references(() => adjustments.id, { onDelete: "restrict" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("payout_questions_question_length", sql`length(trim(${t.question})) >= 3`),
    check(
      "payout_questions_resolved_has_resolution",
      sql`${t.status} <> 'RESOLVED' OR (${t.resolution} IS NOT NULL AND ${t.resolvedBy} IS NOT NULL AND ${t.resolvedAt} IS NOT NULL)`,
    ),
    index("payout_questions_entry_idx").on(t.ledgerEntryId),
    index("payout_questions_status_idx").on(t.status),
  ],
);

// Period close (roadmap 2.9): a closed month refuses payments dated in it and adjustments made
// while it is closed. Only an Admin closes or reopens a month, and reopening needs a reason.
export const payoutPeriods = pgTable(
  "payout_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    // Calendar month in the operating timezone, YYYY-MM.
    period: char("period", { length: 7 }).notNull(),
    locked: boolean("locked").notNull(),
    lockedBy: userRef("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockNote: text("lock_note"),
    unlockedBy: userRef("unlocked_by"),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
    unlockReason: text("unlock_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("payout_periods_org_period_unique").on(t.organizationId, t.period),
    check("payout_periods_format", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("payout_periods_locked_by", sql`NOT ${t.locked} OR (${t.lockedBy} IS NOT NULL AND ${t.lockedAt} IS NOT NULL)`),
  ],
);

// Discussion on a project, optionally about one task (roadmap Stage 2: comments and mentions).
// Append-only, like the rest of the history.
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "restrict" }),
    authorId: userRef("author_id").notNull(),
    body: text("body").notNull(),
    mentionedIds: uuid("mentioned_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt,
  },
  (t) => [
    check("comments_body_length", sql`length(trim(${t.body})) BETWEEN 1 AND 5000`),
    index("comments_project_idx").on(t.projectId, t.createdAt),
  ],
);

// Reusable outlines of milestones and tasks (roadmap 2.7), written in a plain-text format
// parsed by src/modules/templates/outline.ts. Deactivated, never deleted.
export const projectTemplates = pgTable(
  "project_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    name: text("name").notNull(),
    description: text("description"),
    outline: text("outline").notNull(),
    active: boolean("active").notNull().default(true),
    // Null for the starter templates shipped with the app.
    createdBy: userRef("created_by"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("project_templates_org_name_unique").on(t.organizationId, t.name),
    check("project_templates_name_length", sql`length(trim(${t.name})) >= 3`),
  ],
);

// GitHub integration (roadmap 2.5). Written by people (links pasted on a task) and by the GitHub
// webhook (pull requests, reviews, issues, deployments and releases), which runs as the system.
export const githubLinkKind = pgEnum("github_link_kind", ["ISSUE", "PULL_REQUEST", "COMMIT", "BRANCH"]);

export const taskLinks = pgTable(
  "task_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    kind: githubLinkKind("kind").notNull(),
    /** "owner/name", lower case. */
    repo: text("repo").notNull(),
    number: integer("number"),
    /** Branch name or commit SHA. */
    ref: text("ref"),
    /** Identity of the linked item, e.g. "PULL_REQUEST:agod/app#12"; unique per task. */
    key: text("key").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    /** open, closed, merged or draft, as last reported by GitHub. */
    state: text("state"),
    authorLogin: text("author_login"),
    /** Latest review outcome: approved, changes_requested or commented. */
    reviewState: text("review_state"),
    reviewers: text("reviewers").array().notNull().default(sql`'{}'::text[]`),
    headSha: text("head_sha"),
    mergeCommitSha: text("merge_commit_sha"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    /** Null when linked automatically by the webhook. */
    linkedBy: userRef("linked_by"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("task_links_task_key_unique").on(t.taskId, t.key),
    index("task_links_project_idx").on(t.projectId),
    index("task_links_repo_number_idx").on(t.repo, t.number),
  ],
);

export const githubDeliveries = pgTable("github_deliveries", {
  /** X-GitHub-Delivery: each delivery is processed once, even if GitHub redelivers it. */
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  action: text("action"),
  repo: text("repo"),
  summary: text("summary").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const githubDeployments = pgTable(
  "github_deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    githubId: bigint("github_id", { mode: "number" }).notNull(),
    repo: text("repo").notNull(),
    environment: text("environment").notNull(),
    ref: text("ref"),
    sha: text("sha").notNull(),
    /** Latest deployment status: pending, in_progress, success, failure, error or inactive. */
    state: text("state").notNull(),
    url: text("url"),
    createdAt,
    updatedAt,
  },
  (t) => [index("github_deployments_repo_sha_idx").on(t.repo, t.sha), uniqueIndex("github_deployments_org_github_id").on(t.organizationId, t.githubId)],
);

export const githubReleases = pgTable(
  "github_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    githubId: bigint("github_id", { mode: "number" }).notNull(),
    repo: text("repo").notNull(),
    tag: text("tag").notNull(),
    name: text("name"),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [index("github_releases_repo_idx").on(t.repo), uniqueIndex("github_releases_org_github_id").on(t.organizationId, t.githubId)],
);

// File attachments (roadmap Stage 2): project documents, task deliverables and payment receipts.
// The file itself lives in private storage (Vercel Blob); this row records who may see it.
// Payment receipts are never removed; other files are soft-removed (the row and file stay).
export const attachmentKind = pgEnum("attachment_kind", ["PROJECT", "TASK", "PAYMENT"]);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    kind: attachmentKind("kind").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id").references(() => paymentTransactions.id, { onDelete: "restrict" }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Storage pathname; never sent to browsers (downloads go through the app). */
    storageKey: text("storage_key").notNull(),
    uploadedBy: userRef("uploaded_by").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: userRef("removed_by"),
    createdAt,
  },
  (t) => [
    check(
      "attachments_target_matches_kind",
      sql`(${t.kind} = 'PROJECT' AND ${t.taskId} IS NULL AND ${t.paymentId} IS NULL)
       OR (${t.kind} = 'TASK' AND ${t.taskId} IS NOT NULL AND ${t.paymentId} IS NULL)
       OR (${t.kind} = 'PAYMENT' AND ${t.paymentId} IS NOT NULL AND ${t.taskId} IS NULL)`,
    ),
    check("attachments_size", sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 4194304`),
    check("attachments_removed_pair", sql`(${t.removedAt} IS NULL) = (${t.removedBy} IS NULL)`),
    index("attachments_project_idx").on(t.projectId),
    index("attachments_task_idx").on(t.taskId),
    index("attachments_payment_idx").on(t.paymentId),
  ],
);

// Project costs other than contributor payouts (Stage 3): software, hosting, subcontractors...
// Never edited or deleted; a wrong entry is voided with a reason and stays visible.
export const projectCosts = pgTable(
  "project_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    category: costCategory("category").notNull(),
    description: text("description").notNull(),
    vendor: text("vendor"),
    amountMinor: money("amount_minor").notNull(),
    currency: currency(),
    incurredOn: date("incurred_on").notNull(),
    createdBy: userRef("created_by").notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: userRef("voided_by"),
    voidReason: text("void_reason"),
    createdAt,
  },
  (t) => [
    check("project_costs_amount_positive", sql`${t.amountMinor} > 0`),
    check("project_costs_description", sql`length(trim(${t.description})) >= 3`),
    check(
      "project_costs_void_complete",
      sql`(${t.voidedAt} IS NULL AND ${t.voidedBy} IS NULL AND ${t.voidReason} IS NULL)
       OR (${t.voidedAt} IS NOT NULL AND ${t.voidedBy} IS NOT NULL AND length(trim(coalesce(${t.voidReason}, ''))) >= 3)`,
    ),
    index("project_costs_project_idx").on(t.projectId),
    index("project_costs_incurred_idx").on(t.incurredOn),
  ],
);

// Phase 17 (services and subscriptions): a catalogue of what AGOD sells, and each customer's
// commitments to it. A subscription keeps its own negotiated terms; once active, commercial terms
// change only through an amendment, which records the old and new values.
export const billingCadence = pgEnum("billing_cadence", ["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"]);
export const pricingBasis = pgEnum("pricing_basis", ["FIXED", "PER_SEAT", "USAGE", "OTHER"]);
export const subscriptionStatus = pgEnum("subscription_status", ["DRAFT", "ACTIVE", "PAUSED", "ENDED", "CANCELLED"]);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    // Short, stable code, e.g. HOSTING-STD.
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    defaultCadence: billingCadence("default_cadence").notNull().default("MONTHLY"),
    defaultPriceMinor: money("default_price_minor"),
    currency: currency(),
    // Inactive services stay on existing subscriptions but can't be picked for new ones.
    active: boolean("active").notNull().default(true),
    createdBy: userRef("created_by").notNull(),
    version: integer("version").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("services_code_unique").on(t.organizationId, sql`upper(${t.code})`),
    check("services_code_format", sql`${t.code} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$'`),
    check("services_name_not_blank", sql`length(btrim(${t.name})) >= 2`),
    check("services_default_price", sql`${t.defaultPriceMinor} IS NULL OR ${t.defaultPriceMinor} >= 0`),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    // The service's name when the subscription was created; later catalogue renames don't rewrite it.
    serviceName: text("service_name").notNull(),
    status: subscriptionStatus("status").notNull().default("DRAFT"),
    startDate: date("start_date").notNull(),
    // Null for open-ended subscriptions.
    endDate: date("end_date"),
    // When the next renewal decision is due (not the same as the end date).
    renewalDate: date("renewal_date"),
    noticePeriodDays: integer("notice_period_days").notNull().default(30),
    billingCadence: billingCadence("billing_cadence").notNull(),
    priceMinor: money("price_minor").notNull(),
    currency: currency(),
    pricingBasis: pricingBasis("pricing_basis").notNull().default("FIXED"),
    quantity: integer("quantity").notNull().default(1),
    paymentTerms: text("payment_terms"),
    ownerId: userRef("owner_id").notNull(),
    renewalOwnerId: userRef("renewal_owner_id"),
    externalReference: text("external_reference"),
    notes: text("notes"),
    // Why it was paused, ended or cancelled (latest status change).
    statusReason: text("status_reason"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdBy: userRef("created_by").notNull(),
    version: integer("version").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("subscriptions_customer_idx").on(t.customerId),
    index("subscriptions_service_idx").on(t.serviceId),
    index("subscriptions_renewal_idx").on(t.renewalDate),
    check("subscriptions_price", sql`${t.priceMinor} >= 0`),
    check("subscriptions_quantity", sql`${t.quantity} >= 1`),
    check("subscriptions_notice", sql`${t.noticePeriodDays} BETWEEN 0 AND 365`),
    check("subscriptions_end_after_start", sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
    check(
      "subscriptions_renewal_in_term",
      sql`${t.renewalDate} IS NULL OR (${t.renewalDate} >= ${t.startDate} AND (${t.endDate} IS NULL OR ${t.renewalDate} <= ${t.endDate}))`,
    ),
    check(
      "subscriptions_ended_matches_status",
      sql`(${t.status} IN ('ENDED', 'CANCELLED')) = (${t.endedAt} IS NOT NULL)`,
    ),
  ],
);

// Phase 18: a renewal is recorded like an amendment (old and new terms kept), marked as a renewal.
export const amendmentKind = pgEnum("amendment_kind", ["AMENDMENT", "RENEWAL"]);

export const subscriptionAmendments = pgTable(
  "subscription_amendments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "restrict" }),
    kind: amendmentKind("kind").notNull().default("AMENDMENT"),
    effectiveDate: date("effective_date").notNull(),
    // { field: { from, to } } for each changed term.
    changes: jsonb("changes").notNull(),
    reason: text("reason").notNull(),
    createdBy: userRef("created_by").notNull(),
    createdAt,
  },
  (t) => [
    index("subscription_amendments_subscription_idx").on(t.subscriptionId),
    check("subscription_amendments_reason", sql`length(btrim(${t.reason})) >= 3`),
  ],
);

// Phase 19: each person's email choices. No row means the defaults (daily email on).
export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "restrict" }),
  dailyEmail: boolean("daily_email").notNull().default(true),
  updatedAt,
});

// Phase 19: a record of each scheduled job run (the daily reminders), shown to Admins.
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    job: text("job").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ok: boolean("ok"),
    summary: jsonb("summary"),
    error: text("error"),
  },
  (t) => [index("job_runs_job_started_idx").on(t.organizationId, t.job, t.startedAt)],
);

// Phase 20: invoices to customers. Drafts are edited freely; issuing assigns the number and
// freezes the lines. "Paid" and "overdue" are worked out from payments and the due date.
export const invoiceStatus = pgEnum("invoice_status", ["DRAFT", "ISSUED", "VOID"]);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    // INV-<year>-<nnnn>, given when issued, so drafts don't use up numbers.
    number: text("number"),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    status: invoiceStatus("status").notNull().default("DRAFT"),
    issueDate: date("issue_date"),
    dueDate: date("due_date"),
    currency: currency(),
    totalMinor: money("total_minor").notNull().default(0),
    paidMinor: money("paid_minor").notNull().default(0),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    // Copied from the customer when issued, so the invoice reads the same later.
    billToName: text("bill_to_name"),
    billToEmail: text("bill_to_email"),
    notes: text("notes"),
    createdBy: userRef("created_by").notNull(),
    issuedBy: userRef("issued_by"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    voidedBy: userRef("voided_by"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentTo: text("sent_to"),
    // Phase 21: the PDF saved in the customer's Drive "Invoices" folder when issued.
    driveFileId: text("drive_file_id"),
    version: integer("version").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("invoices_customer_idx").on(t.customerId),
    uniqueIndex("invoices_org_number_unique").on(t.organizationId, t.number),
    index("invoices_status_due_idx").on(t.status, t.dueDate),
    check("invoices_number_format", sql`${t.number} IS NULL OR ${t.number} ~ '^INV-[0-9]{4}-[0-9]{4,}$'`),
    check(
      "invoices_issued_complete",
      sql`${t.status} = 'DRAFT' OR (${t.number} IS NOT NULL AND ${t.issueDate} IS NOT NULL AND ${t.dueDate} IS NOT NULL AND ${t.issuedAt} IS NOT NULL)`,
    ),
    check("invoices_due_after_issue", sql`${t.dueDate} IS NULL OR ${t.issueDate} IS NULL OR ${t.dueDate} >= ${t.issueDate}`),
    check("invoices_amounts", sql`${t.totalMinor} >= 0 AND ${t.paidMinor} >= 0 AND ${t.paidMinor} <= ${t.totalMinor}`),
    check("invoices_paid_at", sql`(${t.paidAt} IS NOT NULL) = (${t.status} = 'ISSUED' AND ${t.paidMinor} = ${t.totalMinor} AND ${t.totalMinor} > 0)`),
    check(
      "invoices_void_complete",
      sql`(${t.status} = 'VOID') = (${t.voidedAt} IS NOT NULL AND ${t.voidedBy} IS NOT NULL AND length(btrim(coalesce(${t.voidReason}, ''))) >= 3)`,
    ),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceMinor: money("unit_price_minor").notNull(),
    amountMinor: money("amount_minor").notNull(),
    // What the line bills: a subscription period, or (part of) a project.
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "restrict" }),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    // Set when the invoice is voided, so the period or project amount can be billed again.
    voided: boolean("voided").notNull().default(false),
    createdAt,
  },
  (t) => [
    index("invoice_lines_invoice_idx").on(t.invoiceId),
    index("invoice_lines_project_idx").on(t.projectId),
    check("invoice_lines_description", sql`length(btrim(${t.description})) >= 2`),
    check("invoice_lines_quantity", sql`${t.quantity} >= 1`),
    check("invoice_lines_price", sql`${t.unitPriceMinor} >= 0`),
    check("invoice_lines_amount", sql`${t.amountMinor} = ${t.quantity} * ${t.unitPriceMinor}`),
    check(
      "invoice_lines_period",
      sql`(${t.subscriptionId} IS NULL AND ${t.periodStart} IS NULL AND ${t.periodEnd} IS NULL)
       OR (${t.subscriptionId} IS NOT NULL AND ${t.periodStart} IS NOT NULL AND ${t.periodEnd} IS NOT NULL AND ${t.periodEnd} >= ${t.periodStart})`,
    ),
    check("invoice_lines_one_source", sql`${t.subscriptionId} IS NULL OR ${t.projectId} IS NULL`),
    // A subscription period is billed once (unless its invoice was voided).
    uniqueIndex("invoice_lines_subscription_period")
      .on(t.subscriptionId, t.periodStart)
      .where(sql`${t.subscriptionId} IS NOT NULL AND NOT ${t.voided}`),
  ],
);

export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    amountMinor: money("amount_minor").notNull(),
    paidOn: date("paid_on").notNull(),
    method: paymentMethod("method").notNull(),
    reference: text("reference"),
    note: text("note"),
    recordedBy: userRef("recorded_by").notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: userRef("voided_by"),
    voidReason: text("void_reason"),
    createdAt,
  },
  (t) => [
    index("invoice_payments_invoice_idx").on(t.invoiceId),
    check("invoice_payments_amount", sql`${t.amountMinor} > 0`),
    check(
      "invoice_payments_void_complete",
      sql`(${t.voidedAt} IS NULL AND ${t.voidedBy} IS NULL AND ${t.voidReason} IS NULL)
       OR (${t.voidedAt} IS NOT NULL AND ${t.voidedBy} IS NOT NULL AND length(btrim(coalesce(${t.voidReason}, ''))) >= 3)`,
    ),
  ],
);

// Phase 20: who the company is on its invoices. One row per company (Phase 22), edited by Admins.
export const invoiceSettings = pgTable(
  "invoice_settings",
  {
    organizationId: orgRef().primaryKey(),
    businessName: text("business_name").notNull().default("AGOD"),
    address: text("address"),
    email: text("email"),
    phone: text("phone"),
    taxId: text("tax_id"),
    // How to pay: bank account, MoMo number, ... printed on every invoice.
    paymentInstructions: text("payment_instructions"),
    footer: text("footer"),
    defaultDueDays: integer("default_due_days").notNull().default(14),
    updatedBy: userRef("updated_by"),
    updatedAt,
  },
  (t) => [check("invoice_settings_due_days", sql`${t.defaultDueDays} BETWEEN 0 AND 120`)],
);

// Phase 21: Google (Drive now, Calendar next). One COMPANY connection (the AGOD Google account an
// Admin connects) and, later, PERSONAL ones. Tokens are encrypted and only read by the server
// through the owner connection: the app role has no access to these tables at all.
export const googleConnectionKind = pgEnum("google_connection_kind", ["COMPANY", "PERSONAL"]);

export const googleConnections = pgTable(
  "google_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    kind: googleConnectionKind("kind").notNull(),
    // COMPANY: the Admin who connected it. PERSONAL: whose calendar it is.
    userId: userRef("user_id").notNull(),
    googleEmail: text("google_email").notNull(),
    // AES-256-GCM, key derived from BETTER_AUTH_SECRET.
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    scopes: text("scopes").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    // The last folder and sharing sync (COMPANY): when, and what it did.
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSync: jsonb("last_sync"),
    // Phase 24: the calendar the app keeps in this account (COMPANY: the company calendar; PERSONAL:
    // the person's work calendar) and who it is shared with (as the app last set it).
    calendarId: text("calendar_id"),
    calendarSharedWith: jsonb("calendar_shared_with").notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    uniqueIndex("google_connections_one_company").on(t.organizationId).where(sql`${t.kind} = 'COMPANY' AND ${t.disconnectedAt} IS NULL`),
    uniqueIndex("google_connections_one_personal").on(t.organizationId, t.userId).where(sql`${t.kind} = 'PERSONAL' AND ${t.disconnectedAt} IS NULL`),
  ],
);

/** Drive folders the app created, by what they hold. */
export const driveFolders = pgTable(
  "drive_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleConnections.id, { onDelete: "restrict" }),
    // ROOT (the "AGOD" folder), CUSTOMER, CUSTOMER_INVOICES, PROJECT, INTERNAL (internal projects),
    // RECEIPTS (payment receipts).
    purpose: text("purpose").notNull(),
    entityId: uuid("entity_id"),
    folderId: text("folder_id").notNull(),
    webViewLink: text("web_view_link"),
    // Google accounts the folder is shared with (as the app last set it).
    sharedWith: jsonb("shared_with").notNull().default(sql`'[]'::jsonb`),
    createdAt,
  },
  (t) => [
    uniqueIndex("drive_folders_purpose_entity").on(t.connectionId, t.purpose, sql`coalesce(${t.entityId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    check("drive_folders_purpose", sql`${t.purpose} IN ('ROOT', 'CUSTOMER', 'CUSTOMER_INVOICES', 'PROJECT', 'INTERNAL', 'RECEIPTS')`),
  ],
);

/** Phase 21: links to files elsewhere (Google Drive, or any https URL) on a project or task. */
export const projectLinks = pgTable(
  "project_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "restrict" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    // GOOGLE_DRIVE when the URL is a Google Docs/Sheets/Slides/Drive link.
    provider: text("provider").notNull(),
    addedBy: userRef("added_by").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: userRef("removed_by"),
    createdAt,
  },
  (t) => [
    index("project_links_project_idx").on(t.projectId),
    check("project_links_https", sql`${t.url} ~ '^https://'`),
    check("project_links_title", sql`length(btrim(${t.title})) >= 1`),
    check("project_links_provider", sql`${t.provider} IN ('GOOGLE_DRIVE', 'WEB')`),
    check("project_links_removed_pair", sql`(${t.removedAt} IS NULL) = (${t.removedBy} IS NULL)`),
  ],
);

/** Phase 24: events the app keeps in a Google calendar, by what they show (one per item and calendar). */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleConnections.id, { onDelete: "restrict" }),
    // PROJECT_TARGET, MILESTONE, TASK_DUE, RENEWAL, INVOICE_DUE
    source: text("source").notNull(),
    entityId: uuid("entity_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    // What the event said when last written (title, date, details): unchanged items aren't rewritten.
    fingerprint: text("fingerprint").notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("calendar_events_item").on(t.connectionId, t.source, t.entityId),
    check("calendar_events_source", sql`${t.source} IN ('PROJECT_TARGET', 'MILESTONE', 'TASK_DUE', 'RENEWAL', 'INVOICE_DUE')`),
  ],
);

/** Phase 24: meetings scheduled on a project, as Google Calendar events with a Meet link. */
export const projectMeetings = pgTable(
  "project_meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    agenda: text("agenda"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    googleEventId: text("google_event_id"),
    meetUrl: text("meet_url"),
    createdBy: userRef("created_by").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: userRef("cancelled_by"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("project_meetings_project_idx").on(t.projectId, t.startsAt),
    check("project_meetings_title", sql`length(btrim(${t.title})) BETWEEN 2 AND 200`),
    check("project_meetings_times", sql`${t.endsAt} > ${t.startsAt} AND ${t.endsAt} <= ${t.startsAt} + interval '12 hours'`),
    check("project_meetings_cancelled_pair", sql`(${t.cancelledAt} IS NULL) = (${t.cancelledBy} IS NULL)`),
    check("project_meetings_meet_url", sql`${t.meetUrl} IS NULL OR ${t.meetUrl} ~ '^https://'`),
  ],
);


// Phase 29: the client money flow. A project's payment plan (deposit, milestone and final
// payments, and approved change requests), each invoiced on its own and signed off by the client;
// and change requests that add to the project's value. Managers only (row-level security).

export const changeRequests = pgTable(
  "change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    amountMinor: money("amount_minor").notNull(),
    extraDays: integer("extra_days").notNull().default(0),
    // DRAFT → SENT (to the client) → APPROVED (adds to the project) or REJECTED.
    status: text("status").notNull().default("DRAFT"),
    decidedOn: date("decided_on"),
    decisionNote: text("decision_note"),
    decidedBy: userRef("decided_by"),
    createdBy: userRef("created_by").notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("change_requests_project_idx").on(t.projectId),
    check("change_requests_status", sql`${t.status} IN ('DRAFT', 'SENT', 'APPROVED', 'REJECTED')`),
    check("change_requests_title", sql`length(btrim(${t.title})) BETWEEN 3 AND 200`),
    check("change_requests_amount", sql`${t.amountMinor} >= 0`),
    check("change_requests_days", sql`${t.extraDays} BETWEEN 0 AND 365`),
    check("change_requests_decided", sql`(${t.status} IN ('APPROVED', 'REJECTED')) = (${t.decidedOn} IS NOT NULL)`),
  ],
);

export const billingStages = pgTable(
  "billing_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    // DEPOSIT (before work starts), MILESTONE, FINAL, or CHANGE (an approved change request).
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    amountMinor: money("amount_minor").notNull(),
    milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "restrict" }),
    changeRequestId: uuid("change_request_id").references(() => changeRequests.id, { onDelete: "restrict" }),
    // The invoice line that bills this stage (cleared if a draft line is removed; a void invoice's
    // line is marked voided, and the stage can be invoiced again).
    invoiceLineId: uuid("invoice_line_id").references(() => invoiceLines.id, { onDelete: "set null" }),
    // Client sign-off: when the work was sent for review, and when (and how) the client accepted.
    reviewSentOn: date("review_sent_on"),
    signedOffOn: date("signed_off_on"),
    signedOffBy: userRef("signed_off_by"),
    signOffNote: text("sign_off_note"),
    createdBy: userRef("created_by").notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("billing_stages_project_position").on(t.projectId, t.position),
    uniqueIndex("billing_stages_invoice_line").on(t.invoiceLineId),
    check("billing_stages_kind", sql`${t.kind} IN ('DEPOSIT', 'MILESTONE', 'FINAL', 'CHANGE')`),
    check("billing_stages_label", sql`length(btrim(${t.label})) BETWEEN 2 AND 120`),
    check("billing_stages_amount", sql`${t.amountMinor} > 0`),
    check("billing_stages_signoff", sql`(${t.signedOffOn} IS NULL) = (${t.signedOffBy} IS NULL)`),
  ],
);

// Phase 30: in-app messages between people of the same company: one-to-one and small group
// conversations. Only the people in a conversation can read it (row-level security); Admins
// can't read other people's messages.

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    // Group conversations may have a name; one-to-one conversations don't.
    title: text("title"),
    createdBy: userRef("created_by").notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt,
  },
  (t) => [check("conversations_title", sql`${t.title} IS NULL OR length(btrim(${t.title})) BETWEEN 2 AND 80`)],
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "restrict" }),
    userId: userRef("user_id").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt,
  },
  (t) => [uniqueIndex("conversation_members_unique").on(t.conversationId, t.userId), index("conversation_members_user_idx").on(t.userId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "restrict" }),
    authorId: userRef("author_id").notNull(),
    body: text("body").notNull(),
    createdAt,
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    check("messages_body", sql`length(btrim(${t.body})) BETWEEN 1 AND 4000`),
  ],
);

// Phase 32: change control for regulated (fintech) teams. Each release of a project's software is
// recorded with what changed, why, its security impact, how it was tested and how to undo it, and
// goes through approval by someone who didn't write it before it is deployed. Urgent fixes may be
// deployed first and approved afterwards (emergency path).

export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    versionLabel: text("version_label"),
    changeSummary: text("change_summary").notNull(),
    reason: text("reason").notNull(),
    // LOW, MEDIUM, HIGH; HIGH needs a security review by someone other than the author.
    securityImpact: text("security_impact").notNull(),
    testEvidence: text("test_evidence").notNull(),
    rollbackPlan: text("rollback_plan").notNull(),
    emergency: boolean("emergency").notNull().default(false),
    // DRAFT → SUBMITTED → APPROVED → DEPLOYED (→ ROLLED_BACK); or REJECTED. Emergency: SUBMITTED →
    // DEPLOYED, approved afterwards (decided_* set while DEPLOYED).
    status: text("status").notNull().default("DRAFT"),
    createdBy: userRef("created_by").notNull(),
    submittedBy: userRef("submitted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    securityReviewedBy: userRef("security_reviewed_by"),
    securityReviewedAt: timestamp("security_reviewed_at", { withTimezone: true }),
    securityNote: text("security_note"),
    decidedBy: userRef("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decision: text("decision"),
    decisionNote: text("decision_note"),
    deployedBy: userRef("deployed_by"),
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
    deployNote: text("deploy_note"),
    rolledBackBy: userRef("rolled_back_by"),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    rollbackNote: text("rollback_note"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("releases_project_idx").on(t.projectId),
    index("releases_status_idx").on(t.status),
    check("releases_status", sql`${t.status} IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'DEPLOYED', 'ROLLED_BACK')`),
    check("releases_impact", sql`${t.securityImpact} IN ('LOW', 'MEDIUM', 'HIGH')`),
    check("releases_decision", sql`${t.decision} IS NULL OR ${t.decision} IN ('APPROVED', 'REJECTED')`),
    check("releases_title", sql`length(btrim(${t.title})) BETWEEN 3 AND 200`),
    check(
      "releases_texts",
      sql`length(btrim(${t.changeSummary})) BETWEEN 10 AND 4000 AND length(btrim(${t.reason})) BETWEEN 3 AND 2000
        AND length(btrim(${t.testEvidence})) BETWEEN 3 AND 4000 AND length(btrim(${t.rollbackPlan})) BETWEEN 3 AND 2000`,
    ),
  ],
);
