CREATE TYPE "public"."adjustment_type" AS ENUM('INCREASE', 'DECREASE', 'WRITE_OFF', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."client_type" AS ENUM('INTERNAL', 'EXTERNAL');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('MOBILE_MONEY', 'BANK_TRANSFER', 'CASH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('OWED', 'PARTIALLY_PAID', 'PAID', 'DISPUTED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('DRAFT', 'PLANNING', 'IN_PROGRESS', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."split_type" AS ENUM('PERCENTAGE', 'FIXED_AMOUNT');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'WAIVED');--> statement-breakpoint
CREATE TABLE "adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"type" "adjustment_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustments_amount_non_negative" CHECK ("adjustments"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"project_id" uuid,
	"action" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"reason" text,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compensation_snapshot_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role_on_project" text NOT NULL,
	"source_assignment_id" uuid NOT NULL,
	"split_type" "split_type" NOT NULL,
	"split_basis_points" integer,
	"split_amount_minor" bigint,
	"amount_owed_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'GHS' NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_lines_amount_non_negative" CHECK ("compensation_snapshot_lines"."amount_owed_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "compensation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"project_total_value_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'GHS' NOT NULL,
	"split_mode" "split_type" NOT NULL,
	"calculation_version" integer NOT NULL,
	"calculation_notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compensation_snapshots_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"sequence" integer NOT NULL,
	"due_date" date,
	"status" "milestone_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'GHS' NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"paid_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid NOT NULL,
	"evidence_file_path" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payment_transactions"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payout_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"snapshot_line_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_owed_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'GHS' NOT NULL,
	"status" "payout_status" DEFAULT 'OWED' NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_ledger_entries_snapshot_line_id_unique" UNIQUE("snapshot_line_id"),
	CONSTRAINT "ledger_amount_non_negative" CHECK ("payout_ledger_entries"."amount_owed_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role_on_project" text NOT NULL,
	"split_type" "split_type" NOT NULL,
	"split_basis_points" integer,
	"split_amount_minor" bigint,
	"rationale" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_assignments_split_value_matches_type" CHECK (("project_assignments"."split_type" = 'PERCENTAGE' AND "project_assignments"."split_basis_points" BETWEEN 0 AND 10000 AND "project_assignments"."split_amount_minor" IS NULL)
       OR ("project_assignments"."split_type" = 'FIXED_AMOUNT' AND "project_assignments"."split_amount_minor" >= 0 AND "project_assignments"."split_basis_points" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"client_type" "client_type" NOT NULL,
	"client_name" text,
	"total_value_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'GHS' NOT NULL,
	"split_mode" "split_type" DEFAULT 'PERCENTAGE' NOT NULL,
	"status" "project_status" DEFAULT 'DRAFT' NOT NULL,
	"project_owner_id" uuid NOT NULL,
	"start_date" date,
	"target_date" date,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code"),
	CONSTRAINT "projects_total_value_non_negative" CHECK ("projects"."total_value_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"milestone_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"assigned_to" uuid,
	"required" boolean DEFAULT true NOT NULL,
	"status" "task_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"completion_note" text,
	"evidence_url" text,
	"blocked_reason" text,
	"blocked_needs" text,
	"waived_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_done_requires_note" CHECK ("tasks"."status" <> 'DONE' OR ("tasks"."completion_note" IS NOT NULL AND "tasks"."completed_at" IS NOT NULL)),
	CONSTRAINT "tasks_blocked_requires_reason" CHECK ("tasks"."status" <> 'BLOCKED' OR ("tasks"."blocked_reason" IS NOT NULL AND "tasks"."blocked_needs" IS NOT NULL)),
	CONSTRAINT "tasks_waived_requires_reason" CHECK ("tasks"."status" <> 'WAIVED' OR "tasks"."waived_reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_ledger_entry_id_payout_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."payout_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_snapshot_lines" ADD CONSTRAINT "compensation_snapshot_lines_snapshot_id_compensation_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."compensation_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_snapshot_lines" ADD CONSTRAINT "compensation_snapshot_lines_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_snapshot_lines" ADD CONSTRAINT "compensation_snapshot_lines_source_assignment_id_project_assignments_id_fk" FOREIGN KEY ("source_assignment_id") REFERENCES "public"."project_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_snapshots" ADD CONSTRAINT "compensation_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_snapshots" ADD CONSTRAINT "compensation_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_ledger_entry_id_payout_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."payout_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_ledger_entries" ADD CONSTRAINT "payout_ledger_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_ledger_entries" ADD CONSTRAINT "payout_ledger_entries_snapshot_line_id_compensation_snapshot_lines_id_fk" FOREIGN KEY ("snapshot_line_id") REFERENCES "public"."compensation_snapshot_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_ledger_entries" ADD CONSTRAINT "payout_ledger_entries_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_ledger_entries" ADD CONSTRAINT "payout_ledger_entries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_project_owner_id_users_id_fk" FOREIGN KEY ("project_owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustments_ledger_idx" ON "adjustments" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_project_idx" ON "audit_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "snapshot_lines_member_idx" ON "compensation_snapshot_lines" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "milestones_project_sequence_unique" ON "milestones" USING btree ("project_id","sequence");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id","read_at");--> statement-breakpoint
CREATE INDEX "payments_ledger_idx" ON "payment_transactions" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "ledger_member_idx" ON "payout_ledger_entries" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ledger_project_idx" ON "payout_ledger_entries" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_assignments_active_unique" ON "project_assignments" USING btree ("project_id","member_id","role_on_project") WHERE "project_assignments"."active";--> statement-breakpoint
CREATE INDEX "project_assignments_member_idx" ON "project_assignments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("project_owner_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_assigned_to_idx" ON "tasks" USING btree ("assigned_to");