CREATE TABLE "community_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"welcome_video_url" text,
	"welcome_video_title" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_settings_one_row" CHECK ("community_settings"."id" = 1),
	CONSTRAINT "community_settings_video" CHECK ("community_settings"."welcome_video_url" IS NULL OR "community_settings"."welcome_video_url" ~ '^https://[^\s]+$'),
	CONSTRAINT "community_settings_title" CHECK ("community_settings"."welcome_video_title" IS NULL OR length(btrim("community_settings"."welcome_video_title")) BETWEEN 2 AND 120)
);
--> statement-breakpoint
CREATE TABLE "front_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"alt" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"added_by" uuid NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "front_photos_alt" CHECK (length(btrim("front_photos"."alt")) BETWEEN 3 AND 200),
	CONSTRAINT "front_photos_type" CHECK ("front_photos"."content_type" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif'))
);
--> statement-breakpoint
ALTER TABLE "community_settings" ADD CONSTRAINT "community_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "front_photos" ADD CONSTRAINT "front_photos_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;