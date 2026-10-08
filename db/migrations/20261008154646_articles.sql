CREATE TABLE "article_bookmarks" (
	"article_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_claps" (
	"article_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"removed_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_comments_body" CHECK (length(btrim("article_comments"."body")) BETWEEN 2 AND 2000),
	CONSTRAINT "article_comments_hidden" CHECK (("article_comments"."hidden_at" IS NULL) = ("article_comments"."hidden_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "article_reposts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_reposts_note" CHECK ("article_reposts"."note" IS NULL OR length("article_reposts"."note") <= 280)
);
--> statement-breakpoint
CREATE TABLE "article_reviews" (
	"article_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_reviews_note" CHECK (length(btrim("article_reviews"."note")) BETWEEN 10 AND 500)
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"reading_minutes" integer DEFAULT 1 NOT NULL,
	"cover_key" text,
	"cover_type" text,
	"cover_bytes" integer,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_status" CHECK ("articles"."status" IN ('DRAFT', 'PUBLISHED')),
	CONSTRAINT "articles_published" CHECK ("articles"."status" = 'DRAFT' OR "articles"."published_at" IS NOT NULL),
	CONSTRAINT "articles_title" CHECK (length(btrim("articles"."title")) BETWEEN 5 AND 150),
	CONSTRAINT "articles_summary" CHECK (length(btrim("articles"."summary")) BETWEEN 10 AND 300),
	CONSTRAINT "articles_body" CHECK (length(btrim("articles"."body")) BETWEEN 50 AND 30000),
	CONSTRAINT "articles_tags" CHECK (cardinality("articles"."tags") <= 5),
	CONSTRAINT "articles_cover" CHECK (("articles"."cover_key" IS NULL) = ("articles"."cover_type" IS NULL) AND ("articles"."cover_type" IS NULL OR "articles"."cover_type" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif'))),
	CONSTRAINT "articles_hidden" CHECK (("articles"."hidden_at" IS NULL) = ("articles"."hidden_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "community_reports" DROP CONSTRAINT "community_reports_target";--> statement-breakpoint
ALTER TABLE "article_bookmarks" ADD CONSTRAINT "article_bookmarks_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_bookmarks" ADD CONSTRAINT "article_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_claps" ADD CONSTRAINT "article_claps_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_claps" ADD CONSTRAINT "article_claps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reposts" ADD CONSTRAINT "article_reposts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reposts" ADD CONSTRAINT "article_reposts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_reviews" ADD CONSTRAINT "article_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_bookmarks_unique" ON "article_bookmarks" USING btree ("article_id","user_id");--> statement-breakpoint
CREATE INDEX "article_bookmarks_user_idx" ON "article_bookmarks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "article_claps_unique" ON "article_claps" USING btree ("article_id","user_id");--> statement-breakpoint
CREATE INDEX "article_comments_article_idx" ON "article_comments" USING btree ("article_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "article_reposts_unique" ON "article_reposts" USING btree ("article_id","user_id");--> statement-breakpoint
CREATE INDEX "article_reposts_created_idx" ON "article_reposts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "article_reviews_unique" ON "article_reviews" USING btree ("article_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "articles_author_idx" ON "articles" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "articles_published_idx" ON "articles" USING btree ("published_at");--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_target" CHECK ("community_reports"."target_type" IN ('PROFILE', 'POST', 'REVIEW', 'SESSION', 'LIBRARY', 'JOB', 'TEAM', 'CHAT', 'ARTICLE', 'ARTICLE_COMMENT'));