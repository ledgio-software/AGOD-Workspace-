CREATE TYPE "public"."contact_channel" AS ENUM('EMAIL', 'PHONE', 'WHATSAPP', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('PROSPECT', 'ACTIVE', 'PAUSED', 'CHURNED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('COMPANY', 'PERSON', 'PARTNER', 'OTHER');--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"email" text,
	"phone" text,
	"preferred_channel" "contact_channel" DEFAULT 'EMAIL' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_billing" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_contacts_reachable" CHECK ("customer_contacts"."email" IS NOT NULL OR "customer_contacts"."phone" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "customer_type" DEFAULT 'COMPANY' NOT NULL,
	"status" "customer_status" DEFAULT 'ACTIVE' NOT NULL,
	"owner_id" uuid NOT NULL,
	"notes" text,
	"external_reference" text,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_name_not_blank" CHECK (length(btrim("customers"."name")) >= 2),
	CONSTRAINT "customers_archived_matches_status" CHECK (("customers"."status" = 'ARCHIVED') = ("customers"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_contacts_customer_idx" ON "customer_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_contacts_one_primary" ON "customer_contacts" USING btree ("customer_id") WHERE "customer_contacts"."is_primary" AND "customer_contacts"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "customers_name_unique" ON "customers" USING btree (lower(btrim("name")));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_customer_idx" ON "projects" USING btree ("customer_id");
-- projects_customer_matches_client_type is added in the next migration, after existing projects are linked.