CREATE TABLE "chat_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"kind" text DEFAULT 'CHAT' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_channels_slug_format" CHECK ("chat_channels"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("chat_channels"."slug") <= 30),
	CONSTRAINT "chat_channels_kind" CHECK ("chat_channels"."kind" IN ('CHAT', 'QUESTIONS'))
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"mentioned_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"last_reply_at" timestamp with time zone,
	"solved_at" timestamp with time zone,
	"solved_by" uuid,
	"removed_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_body" CHECK (length(btrim("chat_messages"."body")) BETWEEN 1 AND 2000),
	CONSTRAINT "chat_messages_mentions" CHECK (cardinality("chat_messages"."mentioned_ids") <= 10),
	CONSTRAINT "chat_messages_solved" CHECK (("chat_messages"."solved_at" IS NULL) = ("chat_messages"."solved_by" IS NULL) AND ("chat_messages"."solved_at" IS NULL OR "chat_messages"."parent_id" IS NULL)),
	CONSTRAINT "chat_messages_hidden" CHECK (("chat_messages"."hidden_at" IS NULL) = ("chat_messages"."hidden_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "chat_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_reactions_emoji" CHECK (length("chat_reactions"."emoji") BETWEEN 1 AND 16)
);
--> statement-breakpoint
CREATE TABLE "chat_reads" (
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "showcase_review_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "showcase_review_replies_body" CHECK (length(btrim("showcase_review_replies"."body")) BETWEEN 2 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "community_reports" DROP CONSTRAINT "community_reports_target";--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_solved_by_users_id_fk" FOREIGN KEY ("solved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_review_replies" ADD CONSTRAINT "showcase_review_replies_review_id_showcase_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."showcase_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showcase_review_replies" ADD CONSTRAINT "showcase_review_replies_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_channels_slug" ON "chat_channels" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "chat_messages_channel_idx" ON "chat_messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_parent_idx" ON "chat_messages" USING btree ("parent_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_author_idx" ON "chat_messages" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_reactions_unique" ON "chat_reactions" USING btree ("message_id","user_id","emoji");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_reads_unique" ON "chat_reads" USING btree ("user_id","channel_id");--> statement-breakpoint
CREATE INDEX "showcase_review_replies_review_idx" ON "showcase_review_replies" USING btree ("review_id","created_at");--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_target" CHECK ("community_reports"."target_type" IN ('PROFILE', 'POST', 'REVIEW', 'SESSION', 'LIBRARY', 'JOB', 'TEAM', 'CHAT'));