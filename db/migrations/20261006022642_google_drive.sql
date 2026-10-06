CREATE TYPE "public"."google_connection_kind" AS ENUM('COMPANY', 'PERSONAL');--> statement-breakpoint
CREATE TABLE "drive_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"entity_id" uuid,
	"folder_id" text NOT NULL,
	"web_view_link" text,
	"shared_with" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_folders_purpose" CHECK ("drive_folders"."purpose" IN ('ROOT', 'CUSTOMER', 'CUSTOMER_INVOICES', 'PROJECT', 'INTERNAL', 'RECEIPTS'))
);
--> statement-breakpoint
CREATE TABLE "google_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "google_connection_kind" NOT NULL,
	"user_id" uuid NOT NULL,
	"google_email" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_sync" jsonb
);
--> statement-breakpoint
CREATE TABLE "project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"added_by" uuid NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_links_https" CHECK ("project_links"."url" ~ '^https://'),
	CONSTRAINT "project_links_title" CHECK (length(btrim("project_links"."title")) >= 1),
	CONSTRAINT "project_links_provider" CHECK ("project_links"."provider" IN ('GOOGLE_DRIVE', 'WEB')),
	CONSTRAINT "project_links_removed_pair" CHECK (("project_links"."removed_at" IS NULL) = ("project_links"."removed_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "drive_file_id" text;--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_connection_id_google_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_folders_purpose_entity" ON "drive_folders" USING btree ("connection_id","purpose",coalesce("entity_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_one_company" ON "google_connections" USING btree ("kind") WHERE "google_connections"."kind" = 'COMPANY' AND "google_connections"."disconnected_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_one_personal" ON "google_connections" USING btree ("user_id") WHERE "google_connections"."kind" = 'PERSONAL' AND "google_connections"."disconnected_at" IS NULL;--> statement-breakpoint
CREATE INDEX "project_links_project_idx" ON "project_links" USING btree ("project_id");