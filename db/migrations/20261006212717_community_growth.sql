CREATE TABLE "library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"url" text,
	"body" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"low_data" boolean DEFAULT false NOT NULL,
	"free" boolean DEFAULT false NOT NULL,
	"featured_at" timestamp with time zone,
	"featured_by" uuid,
	"removed_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_items_kind" CHECK ("library_items"."kind" IN ('TOOL', 'PROMPT', 'GUIDE')),
	CONSTRAINT "library_items_title" CHECK (length(btrim("library_items"."title")) BETWEEN 3 AND 120),
	CONSTRAINT "library_items_summary" CHECK (length(btrim("library_items"."summary")) BETWEEN 10 AND 300),
	CONSTRAINT "library_items_url" CHECK ("library_items"."url" IS NULL OR "library_items"."url" ~ '^https://[^\s]+$'),
	CONSTRAINT "library_items_body" CHECK ("library_items"."body" IS NULL OR length("library_items"."body") <= 4000),
	CONSTRAINT "library_items_content" CHECK (("library_items"."kind" = 'PROMPT' AND "library_items"."body" IS NOT NULL) OR ("library_items"."kind" <> 'PROMPT' AND "library_items"."url" IS NOT NULL)),
	CONSTRAINT "library_items_tags" CHECK (cardinality("library_items"."tags") <= 8),
	CONSTRAINT "library_items_hidden" CHECK (("library_items"."hidden_at" IS NULL) = ("library_items"."hidden_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "library_votes" (
	"item_id" uuid NOT NULL,
	"voter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentorships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mentor_id" uuid NOT NULL,
	"mentee_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"response_note" text,
	"responded_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mentorships_status" CHECK ("mentorships"."status" IN ('PENDING', 'ACTIVE', 'DECLINED', 'WITHDRAWN', 'ENDED')),
	CONSTRAINT "mentorships_self" CHECK ("mentorships"."mentor_id" <> "mentorships"."mentee_id"),
	CONSTRAINT "mentorships_goal" CHECK (length(btrim("mentorships"."goal")) BETWEEN 10 AND 500),
	CONSTRAINT "mentorships_note" CHECK ("mentorships"."response_note" IS NULL OR length("mentorships"."response_note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "project_of_month" (
	"month" text PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"votes" integer DEFAULT 0 NOT NULL,
	"picked_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_of_month_month" CHECK ("project_of_month"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "project_of_month_note" CHECK ("project_of_month"."note" IS NULL OR length("project_of_month"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "project_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"voter_id" uuid NOT NULL,
	"month" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_votes_month" CHECK ("project_votes"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "community_reports" DROP CONSTRAINT "community_reports_target";--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "mentor_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "mentor_capacity" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "mentor_note" text;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_featured_by_users_id_fk" FOREIGN KEY ("featured_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_votes" ADD CONSTRAINT "library_votes_item_id_library_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."library_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_votes" ADD CONSTRAINT "library_votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentorships" ADD CONSTRAINT "mentorships_mentor_id_users_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentorships" ADD CONSTRAINT "mentorships_mentee_id_users_id_fk" FOREIGN KEY ("mentee_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentorships" ADD CONSTRAINT "mentorships_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_of_month" ADD CONSTRAINT "project_of_month_post_id_showcase_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."showcase_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_of_month" ADD CONSTRAINT "project_of_month_picked_by_users_id_fk" FOREIGN KEY ("picked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_votes" ADD CONSTRAINT "project_votes_post_id_showcase_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."showcase_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_votes" ADD CONSTRAINT "project_votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_items_created_idx" ON "library_items" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "library_votes_unique" ON "library_votes" USING btree ("item_id","voter_id");--> statement-breakpoint
CREATE INDEX "mentorships_mentor_idx" ON "mentorships" USING btree ("mentor_id");--> statement-breakpoint
CREATE INDEX "mentorships_mentee_idx" ON "mentorships" USING btree ("mentee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mentorships_one_open" ON "mentorships" USING btree ("mentor_id","mentee_id") WHERE "mentorships"."status" IN ('PENDING', 'ACTIVE');--> statement-breakpoint
CREATE UNIQUE INDEX "project_votes_one_per_month" ON "project_votes" USING btree ("voter_id","month");--> statement-breakpoint
CREATE INDEX "project_votes_month_idx" ON "project_votes" USING btree ("month","post_id");--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_target" CHECK ("community_reports"."target_type" IN ('PROFILE', 'POST', 'REVIEW', 'SESSION', 'LIBRARY'));--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_mentor_capacity" CHECK ("member_profiles"."mentor_capacity" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_mentor_note" CHECK ("member_profiles"."mentor_note" IS NULL OR length("member_profiles"."mentor_note") <= 300);