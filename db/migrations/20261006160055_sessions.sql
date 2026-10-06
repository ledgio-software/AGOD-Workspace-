CREATE TABLE "community_session_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"level" text DEFAULT 'ALL' NOT NULL,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"call_url" text NOT NULL,
	"capacity" integer,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"recording_url" text,
	"notes" text,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_sessions_title" CHECK (length(btrim("community_sessions"."title")) BETWEEN 3 AND 120),
	CONSTRAINT "community_sessions_description" CHECK (length(btrim("community_sessions"."description")) BETWEEN 10 AND 3000),
	CONSTRAINT "community_sessions_level" CHECK ("community_sessions"."level" IN ('BEGINNER', 'INTERMEDIATE', 'ALL')),
	CONSTRAINT "community_sessions_topics" CHECK (cardinality("community_sessions"."topics") <= 8),
	CONSTRAINT "community_sessions_times" CHECK ("community_sessions"."ends_at" > "community_sessions"."starts_at" AND "community_sessions"."ends_at" <= "community_sessions"."starts_at" + interval '6 hours'),
	CONSTRAINT "community_sessions_capacity" CHECK ("community_sessions"."capacity" IS NULL OR "community_sessions"."capacity" BETWEEN 2 AND 1000),
	CONSTRAINT "community_sessions_urls" CHECK (("community_sessions"."call_url" ~ '^https://[^s]+$') AND ("community_sessions"."recording_url" IS NULL OR "community_sessions"."recording_url" ~ '^https://[^\s]+$')),
	CONSTRAINT "community_sessions_notes" CHECK ("community_sessions"."notes" IS NULL OR length("community_sessions"."notes") <= 5000),
	CONSTRAINT "community_sessions_cancelled" CHECK (("community_sessions"."cancelled_at" IS NULL) = ("community_sessions"."cancel_reason" IS NULL)),
	CONSTRAINT "community_sessions_hidden" CHECK (("community_sessions"."hidden_at" IS NULL) = ("community_sessions"."hidden_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "community_reports" DROP CONSTRAINT "community_reports_target";--> statement-breakpoint
ALTER TABLE "community_session_attendees" ADD CONSTRAINT "community_session_attendees_session_id_community_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."community_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_session_attendees" ADD CONSTRAINT "community_session_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_sessions" ADD CONSTRAINT "community_sessions_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_sessions" ADD CONSTRAINT "community_sessions_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_session_attendees_one" ON "community_session_attendees" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE INDEX "community_session_attendees_user_idx" ON "community_session_attendees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "community_sessions_starts_idx" ON "community_sessions" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "community_sessions_host_idx" ON "community_sessions" USING btree ("host_id");--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_target" CHECK ("community_reports"."target_type" IN ('PROFILE', 'POST', 'REVIEW', 'SESSION'));