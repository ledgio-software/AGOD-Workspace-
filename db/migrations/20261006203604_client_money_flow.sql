CREATE TABLE "billing_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid DEFAULT app_org_id() NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"milestone_id" uuid,
	"change_request_id" uuid,
	"invoice_line_id" uuid,
	"review_sent_on" date,
	"signed_off_on" date,
	"signed_off_by" uuid,
	"sign_off_note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_stages_kind" CHECK ("billing_stages"."kind" IN ('DEPOSIT', 'MILESTONE', 'FINAL', 'CHANGE')),
	CONSTRAINT "billing_stages_label" CHECK (length(btrim("billing_stages"."label")) BETWEEN 2 AND 120),
	CONSTRAINT "billing_stages_amount" CHECK ("billing_stages"."amount_minor" > 0),
	CONSTRAINT "billing_stages_signoff" CHECK (("billing_stages"."signed_off_on" IS NULL) = ("billing_stages"."signed_off_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid DEFAULT app_org_id() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"amount_minor" bigint NOT NULL,
	"extra_days" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"decided_on" date,
	"decision_note" text,
	"decided_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_requests_status" CHECK ("change_requests"."status" IN ('DRAFT', 'SENT', 'APPROVED', 'REJECTED')),
	CONSTRAINT "change_requests_title" CHECK (length(btrim("change_requests"."title")) BETWEEN 3 AND 200),
	CONSTRAINT "change_requests_amount" CHECK ("change_requests"."amount_minor" >= 0),
	CONSTRAINT "change_requests_days" CHECK ("change_requests"."extra_days" BETWEEN 0 AND 365),
	CONSTRAINT "change_requests_decided" CHECK (("change_requests"."status" IN ('APPROVED', 'REJECTED')) = ("change_requests"."decided_on" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "default_deposit_basis_points" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "require_deposit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "client_review_days" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "payout_release" text DEFAULT 'ON_APPROVAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_stages" ADD CONSTRAINT "billing_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_stages" ADD CONSTRAINT "billing_stages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_stages" ADD CONSTRAINT "billing_stages_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_stages" ADD CONSTRAINT "billing_stages_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_stages" ADD CONSTRAINT "billing_stages_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_stages" ADD CONSTRAINT "billing_stages_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_stages" ADD CONSTRAINT "billing_stages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_stages_project_position" ON "billing_stages" USING btree ("project_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_stages_invoice_line" ON "billing_stages" USING btree ("invoice_line_id");--> statement-breakpoint
CREATE INDEX "change_requests_project_idx" ON "change_requests" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_deposit" CHECK ("organizations"."default_deposit_basis_points" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_review_days" CHECK ("organizations"."client_review_days" BETWEEN 1 AND 60);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_payout_release" CHECK ("organizations"."payout_release" IN ('ON_APPROVAL', 'ON_CLIENT_PAYMENT'));