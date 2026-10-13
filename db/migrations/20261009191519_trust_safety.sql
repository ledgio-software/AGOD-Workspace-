CREATE TABLE "risk_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"signals" text[] NOT NULL,
	"excerpt" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_flags_target_type" CHECK ("risk_flags"."target_type" IN ('JOB', 'CHAT', 'ARTICLE', 'ARTICLE_COMMENT', 'POST', 'REVIEW', 'PROFILE', 'LIBRARY', 'TEAM')),
	CONSTRAINT "risk_flags_status" CHECK ("risk_flags"."status" IN ('OPEN', 'CLEARED', 'ACTIONED')),
	CONSTRAINT "risk_flags_score" CHECK ("risk_flags"."score" BETWEEN 0 AND 100),
	CONSTRAINT "risk_flags_reviewed" CHECK (("risk_flags"."status" = 'OPEN') = ("risk_flags"."reviewed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "platform_audit" DROP CONSTRAINT "platform_audit_target_type";--> statement-breakpoint
ALTER TABLE "community_jobs" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_jobs" ADD COLUMN "held_reason" text;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD COLUMN "trusted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "risk_flags_target_unique" ON "risk_flags" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "risk_flags_status_idx" ON "risk_flags" USING btree ("status","score");--> statement-breakpoint
CREATE INDEX "risk_flags_author_idx" ON "risk_flags" USING btree ("author_id");--> statement-breakpoint
ALTER TABLE "platform_audit" ADD CONSTRAINT "platform_audit_target_type" CHECK ("platform_audit"."target_type" IN ('COMPANY', 'USER', 'PROFILE', 'CONTENT'));