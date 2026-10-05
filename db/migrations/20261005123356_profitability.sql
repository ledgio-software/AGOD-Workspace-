CREATE TYPE "public"."cost_category" AS ENUM('SOFTWARE', 'HOSTING', 'HARDWARE', 'SUBCONTRACTOR', 'TRAVEL', 'MARKETING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."project_category" AS ENUM('DISCOVERY', 'WEBSITE', 'MOBILE_APP', 'AI_INTEGRATION', 'INTERNAL_PRODUCT', 'MAINTENANCE', 'OTHER');--> statement-breakpoint
CREATE TABLE "project_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"category" "cost_category" NOT NULL,
	"description" text NOT NULL,
	"vendor" text,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'GHS' NOT NULL,
	"incurred_on" date NOT NULL,
	"created_by" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_costs_amount_positive" CHECK ("project_costs"."amount_minor" > 0),
	CONSTRAINT "project_costs_description" CHECK (length(trim("project_costs"."description")) >= 3),
	CONSTRAINT "project_costs_void_complete" CHECK (("project_costs"."voided_at" IS NULL AND "project_costs"."voided_by" IS NULL AND "project_costs"."void_reason" IS NULL)
       OR ("project_costs"."voided_at" IS NOT NULL AND "project_costs"."voided_by" IS NOT NULL AND length(trim(coalesce("project_costs"."void_reason", ''))) >= 3))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "category" "project_category" DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cost_budget_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_costs_project_idx" ON "project_costs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_costs_incurred_idx" ON "project_costs" USING btree ("incurred_on");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cost_budget_non_negative" CHECK ("projects"."cost_budget_minor" >= 0);