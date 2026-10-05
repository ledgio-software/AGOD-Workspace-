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

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    clientType: clientType("client_type").notNull(),
    clientName: text("client_name"),
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
    check("projects_total_value_non_negative", sql`${t.totalValueMinor} >= 0`),
    check("projects_cost_budget_non_negative", sql`${t.costBudgetMinor} >= 0`),
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
    recipientId: userRef("recipient_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    // Set for generated alerts (e.g. "task.overdue:<task>:<due date>") so each is sent once.
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true }),
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
    // Calendar month in the operating timezone, YYYY-MM.
    period: char("period", { length: 7 }).notNull().unique(),
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
    name: text("name").notNull().unique(),
    description: text("description"),
    outline: text("outline").notNull(),
    active: boolean("active").notNull().default(true),
    // Null for the starter templates shipped with the app.
    createdBy: userRef("created_by"),
    createdAt,
    updatedAt,
  },
  (t) => [check("project_templates_name_length", sql`length(trim(${t.name})) >= 3`)],
);

// GitHub integration (roadmap 2.5). Written by people (links pasted on a task) and by the GitHub
// webhook (pull requests, reviews, issues, deployments and releases), which runs as the system.
export const githubLinkKind = pgEnum("github_link_kind", ["ISSUE", "PULL_REQUEST", "COMMIT", "BRANCH"]);

export const taskLinks = pgTable(
  "task_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
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
  (t) => [index("github_deployments_repo_sha_idx").on(t.repo, t.sha)],
);

export const githubReleases = pgTable(
  "github_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
    repo: text("repo").notNull(),
    tag: text("tag").notNull(),
    name: text("name"),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [index("github_releases_repo_idx").on(t.repo)],
);

// File attachments (roadmap Stage 2): project documents, task deliverables and payment receipts.
// The file itself lives in private storage (Vercel Blob); this row records who may see it.
// Payment receipts are never removed; other files are soft-removed (the row and file stay).
export const attachmentKind = pgEnum("attachment_kind", ["PROJECT", "TASK", "PAYMENT"]);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
