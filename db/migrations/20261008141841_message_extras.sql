CREATE TABLE "message_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid DEFAULT app_org_id() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_emoji" CHECK (length("message_reactions"."emoji") BETWEEN 1 AND 16)
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_body";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "kind" text DEFAULT 'TEXT' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sticker" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "voice_key" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "voice_mime" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "voice_seconds" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "voice_bytes" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mentioned_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_reactions_unique" ON "message_reactions" USING btree ("message_id","user_id","emoji");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind" CHECK ("messages"."kind" IN ('TEXT', 'STICKER', 'VOICE'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sticker" CHECK (("messages"."kind" = 'STICKER') = ("messages"."sticker" IS NOT NULL) AND ("messages"."sticker" IS NULL OR "messages"."sticker" ~ '^[a-z]{2,20}$'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_voice" CHECK (("messages"."kind" = 'VOICE') = ("messages"."voice_key" IS NOT NULL) AND ("messages"."voice_key" IS NULL OR ("messages"."voice_mime" IS NOT NULL
        AND "messages"."voice_seconds" BETWEEN 1 AND 120 AND "messages"."voice_bytes" BETWEEN 1 AND 3145728)));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_mentions" CHECK (cardinality("messages"."mentioned_ids") <= 10);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_body" CHECK (("messages"."kind" = 'TEXT' AND length(btrim("messages"."body")) BETWEEN 1 AND 4000) OR ("messages"."kind" <> 'TEXT' AND length("messages"."body") <= 4000));