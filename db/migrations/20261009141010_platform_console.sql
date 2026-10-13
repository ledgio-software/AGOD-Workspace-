CREATE TABLE "platform_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"target_label" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_audit_target_type" CHECK ("platform_audit"."target_type" IN ('COMPANY', 'USER', 'PROFILE')),
	CONSTRAINT "platform_audit_reason" CHECK ("platform_audit"."reason" IS NULL OR length("platform_audit"."reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "platform_audit" ADD CONSTRAINT "platform_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_created_idx" ON "platform_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_target_idx" ON "platform_audit" USING btree ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_suspended" CHECK (("organizations"."suspended_at" IS NULL) = ("organizations"."suspended_reason" IS NULL));