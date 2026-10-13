CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"topic" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"points" integer,
	"comments" integer,
	"discussion_url" text,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_items_topic" CHECK ("news_items"."topic" IN ('AI', 'PROGRAMMING', 'AFRICA', 'RELEASES', 'TECH')),
	CONSTRAINT "news_items_url" CHECK ("news_items"."url" ~ '^https://[^\s]+$' AND length("news_items"."url") <= 2000),
	CONSTRAINT "news_items_discussion_url" CHECK ("news_items"."discussion_url" IS NULL OR "news_items"."discussion_url" ~ '^https://[^\s]+$'),
	CONSTRAINT "news_items_title" CHECK (length(btrim("news_items"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "news_items_summary" CHECK ("news_items"."summary" IS NULL OR length("news_items"."summary") <= 300),
	CONSTRAINT "news_items_hidden" CHECK (("news_items"."hidden_at" IS NULL) = ("news_items"."hidden_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "news_sources" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_useful" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_source_key_news_sources_key_fk" FOREIGN KEY ("source_key") REFERENCES "public"."news_sources"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_useful" ADD CONSTRAINT "news_useful_item_id_news_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."news_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_useful" ADD CONSTRAINT "news_useful_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "news_items_url_unique" ON "news_items" USING btree ("url");--> statement-breakpoint
CREATE INDEX "news_items_published_idx" ON "news_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "news_items_topic_idx" ON "news_items" USING btree ("topic","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "news_useful_unique" ON "news_useful" USING btree ("item_id","user_id");--> statement-breakpoint
CREATE INDEX "news_useful_created_idx" ON "news_useful" USING btree ("created_at");