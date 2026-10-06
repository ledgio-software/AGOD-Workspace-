CREATE TABLE "community_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_reports_target" CHECK ("community_reports"."target_type" IN ('PROFILE')),
	CONSTRAINT "community_reports_reason" CHECK (length(btrim("community_reports"."reason")) BETWEEN 10 AND 1000),
	CONSTRAINT "community_reports_status" CHECK ("community_reports"."status" IN ('OPEN', 'RESOLVED', 'DISMISSED')),
	CONSTRAINT "community_reports_resolved" CHECK (("community_reports"."status" = 'OPEN') = ("community_reports"."resolved_at" IS NULL) AND ("community_reports"."resolved_at" IS NULL) = ("community_reports"."resolved_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "member_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"headline" text,
	"bio" text,
	"city" text,
	"tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"website_url" text,
	"github_url" text,
	"linkedin_url" text,
	"x_url" text,
	"reviewer" boolean DEFAULT false NOT NULL,
	"wants_mentor" boolean DEFAULT false NOT NULL,
	"community_role" text DEFAULT 'BUILDER' NOT NULL,
	"visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"conduct_accepted_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_profiles_handle_format" CHECK ("member_profiles"."handle" ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
	CONSTRAINT "member_profiles_headline" CHECK ("member_profiles"."headline" IS NULL OR length("member_profiles"."headline") <= 140),
	CONSTRAINT "member_profiles_bio" CHECK ("member_profiles"."bio" IS NULL OR length("member_profiles"."bio") <= 1500),
	CONSTRAINT "member_profiles_city" CHECK ("member_profiles"."city" IS NULL OR length("member_profiles"."city") <= 60),
	CONSTRAINT "member_profiles_tools" CHECK (cardinality("member_profiles"."tools") <= 15),
	CONSTRAINT "member_profiles_role" CHECK ("member_profiles"."community_role" IN ('BUILDER', 'ORGANIZER')),
	CONSTRAINT "member_profiles_visibility" CHECK ("member_profiles"."visibility" IN ('PUBLIC', 'MEMBERS')),
	CONSTRAINT "member_profiles_hidden" CHECK (("member_profiles"."hidden_at" IS NULL) = ("member_profiles"."hidden_by" IS NULL)),
	CONSTRAINT "member_profiles_urls" CHECK (("member_profiles"."website_url" IS NULL OR "member_profiles"."website_url" ~ '^https://[^\s]+$') AND ("member_profiles"."github_url" IS NULL OR "member_profiles"."github_url" ~ '^https://[^\s]+$') AND ("member_profiles"."linkedin_url" IS NULL OR "member_profiles"."linkedin_url" ~ '^https://[^\s]+$') AND ("member_profiles"."x_url" IS NULL OR "member_profiles"."x_url" ~ '^https://[^\s]+$'))
);
--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_reports_status_idx" ON "community_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_reports_one_open" ON "community_reports" USING btree ("reporter_id","target_type","target_id") WHERE "community_reports"."status" = 'OPEN';--> statement-breakpoint
CREATE UNIQUE INDEX "member_profiles_handle" ON "member_profiles" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "member_profiles_created_idx" ON "member_profiles" USING btree ("created_at");