CREATE TABLE "company_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid DEFAULT app_org_id() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_role" "user_role" NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_roles_name" CHECK (length(btrim("company_roles"."name")) BETWEEN 2 AND 60)
);
--> statement-breakpoint
CREATE TABLE "job_titles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid DEFAULT app_org_id() NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_titles_name" CHECK (length(btrim("job_titles"."name")) BETWEEN 2 AND 60)
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "company_role_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "job_title_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "team_type" text DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "allow_self_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_roles" ADD CONSTRAINT "company_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_roles" ADD CONSTRAINT "company_roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_titles" ADD CONSTRAINT "job_titles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_roles_org_name" ON "company_roles" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "job_titles_org_name" ON "job_titles" USING btree ("organization_id",lower("name"));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_role_id_company_roles_id_fk" FOREIGN KEY ("company_role_id") REFERENCES "public"."company_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_job_title_id_job_titles_id_fk" FOREIGN KEY ("job_title_id") REFERENCES "public"."job_titles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_team_type" CHECK ("organizations"."team_type" IN ('SOFTWARE', 'FINTECH', 'OTHER'));