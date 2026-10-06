CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'TEAM_MEMBER' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"weekly_capacity_hours" integer DEFAULT 40 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_capacity" CHECK ("memberships"."weekly_capacity_hours" BETWEEN 0 AND 80)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"project_code_prefix" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_name" CHECK (length(btrim("organizations"."name")) BETWEEN 2 AND 120),
	CONSTRAINT "organizations_slug" CHECK ("organizations"."slug" ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
	CONSTRAINT "organizations_code_prefix" CHECK ("organizations"."project_code_prefix" ~ '^[A-Z][A-Z0-9]{1,7}$')
);
--> statement-breakpoint
-- Phase 22 (hand-written): the current company, set per transaction by withActor. New
-- organization_id columns default to it.
CREATE FUNCTION app_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
-- Existing data (if any) becomes the first company, "AGOD"; adding the columns below fills
-- every existing row with it.
INSERT INTO organizations (name, slug, project_code_prefix, created_by)
  SELECT 'AGOD', 'agod', 'AGOD', (SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1)
  WHERE EXISTS (SELECT 1 FROM users);
--> statement-breakpoint
SELECT set_config('app.org_id', coalesce((SELECT id::text FROM organizations WHERE slug = 'agod'), ''), false);
--> statement-breakpoint
-- A new, empty database has no company yet: the starter templates and invoice settings that
-- earlier migrations added are created with each company instead (src/modules/orgs).
DELETE FROM project_templates WHERE app_org_id() IS NULL;
--> statement-breakpoint
DELETE FROM invoice_settings WHERE app_org_id() IS NULL;
--> statement-breakpoint
ALTER TABLE "github_deployments" DROP CONSTRAINT "github_deployments_github_id_unique";--> statement-breakpoint
ALTER TABLE "github_releases" DROP CONSTRAINT "github_releases_github_id_unique";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_number_unique";--> statement-breakpoint
ALTER TABLE "payout_periods" DROP CONSTRAINT "payout_periods_period_unique";--> statement-breakpoint
ALTER TABLE "project_templates" DROP CONSTRAINT "project_templates_name_unique";--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_code_unique";--> statement-breakpoint
ALTER TABLE "invoice_settings" DROP CONSTRAINT "invoice_settings_singleton";--> statement-breakpoint
DROP INDEX "customers_name_unique";--> statement-breakpoint
DROP INDEX "google_connections_one_company";--> statement-breakpoint
DROP INDEX "google_connections_one_personal";--> statement-breakpoint
DROP INDEX "job_runs_job_started_idx";--> statement-breakpoint
DROP INDEX "services_code_unique";--> statement-breakpoint
ALTER TABLE "adjustments" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "compensation_snapshot_lines" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "compensation_snapshots" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "drive_folders" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "github_deployments" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "github_releases" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "google_connections" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_ledger_entries" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_periods" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_questions" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "project_costs" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "project_links" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "project_templates" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_amendments" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "task_links" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "organization_id" uuid DEFAULT app_org_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_snapshot_lines" ADD CONSTRAINT "compensation_snapshot_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_snapshots" ADD CONSTRAINT "compensation_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_deployments" ADD CONSTRAINT "github_deployments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_releases" ADD CONSTRAINT "github_releases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_ledger_entries" ADD CONSTRAINT "payout_ledger_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_periods" ADD CONSTRAINT "payout_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_questions" ADD CONSTRAINT "payout_questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_amendments" ADD CONSTRAINT "subscription_amendments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_deployments_org_github_id" ON "github_deployments" USING btree ("organization_id","github_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_releases_org_github_id" ON "github_releases" USING btree ("organization_id","github_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_unique" ON "invoices" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_periods_org_period_unique" ON "payout_periods" USING btree ("organization_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "project_templates_org_name_unique" ON "project_templates" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_code_unique" ON "projects" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_name_unique" ON "customers" USING btree ("organization_id",lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_one_company" ON "google_connections" USING btree ("organization_id") WHERE "google_connections"."kind" = 'COMPANY' AND "google_connections"."disconnected_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_one_personal" ON "google_connections" USING btree ("organization_id","user_id") WHERE "google_connections"."kind" = 'PERSONAL' AND "google_connections"."disconnected_at" IS NULL;--> statement-breakpoint
CREATE INDEX "job_runs_job_started_idx" ON "job_runs" USING btree ("organization_id","job","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "services_code_unique" ON "services" USING btree ("organization_id",upper("code"));--> statement-breakpoint
-- Everyone's role, active flag and capacity become their AGOD membership.
INSERT INTO memberships (organization_id, user_id, role, active, weekly_capacity_hours)
  SELECT app_org_id(), id, role, active, weekly_capacity_hours FROM users WHERE app_org_id() IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "weekly_capacity_hours";--> statement-breakpoint
SELECT set_config('app.org_id', '', false);
