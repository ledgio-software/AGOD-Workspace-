CREATE TABLE "showcase_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"position" integer NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "showcase_images_type" CHECK ("showcase_images"."content_type" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
	CONSTRAINT "showcase_images_size" CHECK ("showcase_images"."size_bytes" BETWEEN 1 AND 4194304)
);
--> statement-breakpoint
CREATE TABLE "showcase_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"pitch" text NOT NULL,
	"audience" text,
	"built_with" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai_built" boolean DEFAULT false NOT NULL,
	"live_url" text,
	"repo_url" text,
	"video_url" text,
	"feedback_areas" text[] DEFAULT '{}'::text[] NOT NULL,
	"feedback_wanted" text,
	"stuck_on" text,
	"needs" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'NEEDS_REVIEW' NOT NULL,
	"visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"safety_confirmed_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "showcase_posts_title" CHECK (length(btrim("showcase_posts"."title")) BETWEEN 2 AND 120),
	CONSTRAINT "showcase_posts_pitch" CHECK (length(btrim("showcase_posts"."pitch")) BETWEEN 10 AND 200),
	CONSTRAINT "showcase_posts_audience" CHECK ("showcase_posts"."audience" IS NULL OR length("showcase_posts"."audience") <= 200),
	CONSTRAINT "showcase_posts_texts" CHECK (("showcase_posts"."feedback_wanted" IS NULL OR length("showcase_posts"."feedback_wanted") <= 1000) AND ("showcase_posts"."stuck_on" IS NULL OR length("showcase_posts"."stuck_on") <= 1000)),
	CONSTRAINT "showcase_posts_built_with" CHECK (cardinality("showcase_posts"."built_with") <= 15),
	CONSTRAINT "showcase_posts_areas" CHECK ("showcase_posts"."feedback_areas" <@ ARRAY['DESIGN', 'CODE', 'SECURITY', 'IDEA', 'UX']::text[]),
	CONSTRAINT "showcase_posts_needs" CHECK ("showcase_posts"."needs" <@ ARRAY['TESTERS', 'FEEDBACK', 'USERS', 'COLLABORATORS']::text[]),
	CONSTRAINT "showcase_posts_status" CHECK ("showcase_posts"."status" IN ('NEEDS_REVIEW', 'REVIEWED', 'SHIPPED')),
	CONSTRAINT "showcase_posts_visibility" CHECK ("showcase_posts"."visibility" IN ('PUBLIC', 'MEMBERS')),
	CONSTRAINT "showcase_posts_urls" CHECK (("showcase_posts"."live_url" IS NULL OR "showcase_posts"."live_url" ~ '^https://[^\s]+$') AND ("showcase_posts"."repo_url" IS NULL OR "showcase_posts"."repo_url" ~ '^https://[^\s]+$') AND ("showcase_posts"."video_url" IS NULL OR "showcase_posts"."video_url" ~ '^https://[^\s]+$')),
	CONSTRAINT "showcase_posts_hidden" CHECK (("showcase_posts"."hidden_at" IS NULL) = ("showcase_posts"."hidden_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "showcase_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"what_works" text NOT NULL,
	"to_improve" text,
	"next_step" text NOT NULL,
	"author_reply" text,
	"replied_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "showcase_reviews_works" CHECK (length(btrim("showcase_reviews"."what_works")) BETWEEN 10 AND 1500),
	CONSTRAINT "showcase_reviews_improve" CHECK ("showcase_reviews"."to_improve" IS NULL OR length("showcase_reviews"."to_improve") <= 1500),
	CONSTRAINT "showcase_reviews_next" CHECK (length(btrim("showcase_reviews"."next_step")) BETWEEN 10 AND 1000),
	CONSTRAINT "showcase_reviews_reply" CHECK (("showcase_reviews"."author_reply" IS NULL) = ("showcase_reviews"."replied_at" IS NULL) AND ("showcase_reviews"."author_reply" IS NULL OR length("showcase_reviews"."author_reply") BETWEEN 2 AND 1000)),
	CONSTRAINT "showcase_reviews_hidden" CHECK (("showcase_reviews"."hidden_at" IS NULL) = ("showcase_reviews"."hidden_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "community_reports" DROP CONSTRAINT "community_reports_target";--> statement-breakpoint
ALTER TABLE "showcase_images" ADD CONSTRAINT "showcase_images_post_id_showcase_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."showcase_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_posts" ADD CONSTRAINT "showcase_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_posts" ADD CONSTRAINT "showcase_posts_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_reviews" ADD CONSTRAINT "showcase_reviews_post_id_showcase_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."showcase_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_reviews" ADD CONSTRAINT "showcase_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_reviews" ADD CONSTRAINT "showcase_reviews_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "showcase_images_post_idx" ON "showcase_images" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX "showcase_posts_created_idx" ON "showcase_posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "showcase_posts_author_idx" ON "showcase_posts" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "showcase_reviews_one_each" ON "showcase_reviews" USING btree ("post_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "showcase_reviews_reviewer_idx" ON "showcase_reviews" USING btree ("reviewer_id");--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_target" CHECK ("community_reports"."target_type" IN ('PROFILE', 'POST', 'REVIEW'));