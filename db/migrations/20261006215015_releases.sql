CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid DEFAULT app_org_id() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"version_label" text,
	"change_summary" text NOT NULL,
	"reason" text NOT NULL,
	"security_impact" text NOT NULL,
	"test_evidence" text NOT NULL,
	"rollback_plan" text NOT NULL,
	"emergency" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"security_reviewed_by" uuid,
	"security_reviewed_at" timestamp with time zone,
	"security_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision" text,
	"decision_note" text,
	"deployed_by" uuid,
	"deployed_at" timestamp with time zone,
	"deploy_note" text,
	"rolled_back_by" uuid,
	"rolled_back_at" timestamp with time zone,
	"rollback_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_status" CHECK ("releases"."status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'DEPLOYED', 'ROLLED_BACK')),
	CONSTRAINT "releases_impact" CHECK ("releases"."security_impact" IN ('LOW', 'MEDIUM', 'HIGH')),
	CONSTRAINT "releases_decision" CHECK ("releases"."decision" IS NULL OR "releases"."decision" IN ('APPROVED', 'REJECTED')),
	CONSTRAINT "releases_title" CHECK (length(btrim("releases"."title")) BETWEEN 3 AND 200),
	CONSTRAINT "releases_texts" CHECK (length(btrim("releases"."change_summary")) BETWEEN 10 AND 4000 AND length(btrim("releases"."reason")) BETWEEN 3 AND 2000
        AND length(btrim("releases"."test_evidence")) BETWEEN 3 AND 4000 AND length(btrim("releases"."rollback_plan")) BETWEEN 3 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "release_control" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_security_reviewed_by_users_id_fk" FOREIGN KEY ("security_reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_deployed_by_users_id_fk" FOREIGN KEY ("deployed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_rolled_back_by_users_id_fk" FOREIGN KEY ("rolled_back_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "releases_project_idx" ON "releases" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "releases_status_idx" ON "releases" USING btree ("status");