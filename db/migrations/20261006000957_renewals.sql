CREATE TYPE "public"."amendment_kind" AS ENUM('AMENDMENT', 'RENEWAL');--> statement-breakpoint
ALTER TABLE "subscription_amendments" ADD COLUMN "kind" "amendment_kind" DEFAULT 'AMENDMENT' NOT NULL;