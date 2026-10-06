CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid DEFAULT app_org_id() NOT NULL,
	"connection_id" uuid NOT NULL,
	"source" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"google_event_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_source" CHECK ("calendar_events"."source" IN ('PROJECT_TARGET', 'MILESTONE', 'TASK_DUE', 'RENEWAL', 'INVOICE_DUE'))
);
--> statement-breakpoint
CREATE TABLE "project_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid DEFAULT app_org_id() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"agenda" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"google_event_id" text,
	"meet_url" text,
	"created_by" uuid NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_meetings_title" CHECK (length(btrim("project_meetings"."title")) BETWEEN 2 AND 200),
	CONSTRAINT "project_meetings_times" CHECK ("project_meetings"."ends_at" > "project_meetings"."starts_at" AND "project_meetings"."ends_at" <= "project_meetings"."starts_at" + interval '12 hours'),
	CONSTRAINT "project_meetings_cancelled_pair" CHECK (("project_meetings"."cancelled_at" IS NULL) = ("project_meetings"."cancelled_by" IS NULL)),
	CONSTRAINT "project_meetings_meet_url" CHECK ("project_meetings"."meet_url" IS NULL OR "project_meetings"."meet_url" ~ '^https://')
);
--> statement-breakpoint
ALTER TABLE "google_connections" ADD COLUMN "calendar_id" text;--> statement-breakpoint
ALTER TABLE "google_connections" ADD COLUMN "calendar_shared_with" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_connection_id_google_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meetings" ADD CONSTRAINT "project_meetings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meetings" ADD CONSTRAINT "project_meetings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meetings" ADD CONSTRAINT "project_meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meetings" ADD CONSTRAINT "project_meetings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_item" ON "calendar_events" USING btree ("connection_id","source","entity_id");--> statement-breakpoint
CREATE INDEX "project_meetings_project_idx" ON "project_meetings" USING btree ("project_id","starts_at");