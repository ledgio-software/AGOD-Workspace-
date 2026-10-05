CREATE TYPE "public"."payout_question_status" AS ENUM('OPEN', 'AWAITING_ADMIN', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."project_health" AS ENUM('ON_TRACK', 'AT_RISK', 'BLOCKED', 'OVERDUE');--> statement-breakpoint
CREATE TABLE "payout_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" char(7) NOT NULL,
	"locked" boolean NOT NULL,
	"locked_by" uuid,
	"locked_at" timestamp with time zone,
	"lock_note" text,
	"unlocked_by" uuid,
	"unlocked_at" timestamp with time zone,
	"unlock_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_periods_period_unique" UNIQUE("period"),
	CONSTRAINT "payout_periods_format" CHECK ("payout_periods"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payout_periods_locked_by" CHECK (NOT "payout_periods"."locked" OR ("payout_periods"."locked_by" IS NOT NULL AND "payout_periods"."locked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "payout_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"question" text NOT NULL,
	"status" "payout_question_status" DEFAULT 'OPEN' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"adjustment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_questions_question_length" CHECK (length(trim("payout_questions"."question")) >= 3),
	CONSTRAINT "payout_questions_resolved_has_resolution" CHECK ("payout_questions"."status" <> 'RESOLVED' OR ("payout_questions"."resolution" IS NOT NULL AND "payout_questions"."resolved_by" IS NOT NULL AND "payout_questions"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "health_override" "project_health";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "health_override_reason" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "health_override_by" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "health_override_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_periods" ADD CONSTRAINT "payout_periods_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_periods" ADD CONSTRAINT "payout_periods_unlocked_by_users_id_fk" FOREIGN KEY ("unlocked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_questions" ADD CONSTRAINT "payout_questions_ledger_entry_id_payout_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."payout_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_questions" ADD CONSTRAINT "payout_questions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_questions" ADD CONSTRAINT "payout_questions_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_questions" ADD CONSTRAINT "payout_questions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_questions" ADD CONSTRAINT "payout_questions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_questions" ADD CONSTRAINT "payout_questions_adjustment_id_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_questions_entry_idx" ON "payout_questions" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "payout_questions_status_idx" ON "payout_questions" USING btree ("status");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_health_override_by_users_id_fk" FOREIGN KEY ("health_override_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("recipient_id","dedupe_key") WHERE "notifications"."dedupe_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_health_override_has_reason" CHECK (("projects"."health_override" IS NULL AND "projects"."health_override_reason" IS NULL)
       OR ("projects"."health_override" IS NOT NULL AND length(trim(coalesce("projects"."health_override_reason", ''))) >= 3 AND "projects"."health_override_by" IS NOT NULL));