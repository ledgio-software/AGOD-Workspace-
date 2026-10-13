CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"target_type" text,
	"target_id" uuid,
	"message" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeals_kind" CHECK ("appeals"."kind" IN ('ACCOUNT', 'CONTENT')),
	CONSTRAINT "appeals_status" CHECK ("appeals"."status" IN ('OPEN', 'ACCEPTED', 'REJECTED')),
	CONSTRAINT "appeals_target" CHECK (("appeals"."kind" = 'CONTENT') = ("appeals"."target_type" IS NOT NULL AND "appeals"."target_id" IS NOT NULL)),
	CONSTRAINT "appeals_message" CHECK (length(btrim("appeals"."message")) BETWEEN 20 AND 2000),
	CONSTRAINT "appeals_decided" CHECK (("appeals"."status" = 'OPEN') = ("appeals"."decided_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "login_signals" (
	"user_id" uuid NOT NULL,
	"ip_hash" text NOT NULL,
	"device_hash" text NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_audit" DROP CONSTRAINT "platform_audit_target_type";--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "verified_hirer_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "verified_hirer_note" text;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_signals" ADD CONSTRAINT "login_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appeals_status_idx" ON "appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "appeals_email_idx" ON "appeals" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "login_signals_unique" ON "login_signals" USING btree ("user_id","ip_hash","device_hash");--> statement-breakpoint
CREATE INDEX "login_signals_ip_idx" ON "login_signals" USING btree ("ip_hash");--> statement-breakpoint
CREATE INDEX "login_signals_last_seen_idx" ON "login_signals" USING btree ("last_seen");--> statement-breakpoint
ALTER TABLE "platform_audit" ADD CONSTRAINT "platform_audit_target_type" CHECK ("platform_audit"."target_type" IN ('COMPANY', 'USER', 'PROFILE', 'CONTENT', 'APPEAL'));