CREATE TYPE "public"."billing_cadence" AS ENUM('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."pricing_basis" AS ENUM('FIXED', 'PER_SEAT', 'USAGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_cadence" "billing_cadence" DEFAULT 'MONTHLY' NOT NULL,
	"default_price_minor" bigint,
	"currency" char(3) DEFAULT 'GHS' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_code_format" CHECK ("services"."code" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$'),
	CONSTRAINT "services_name_not_blank" CHECK (length(btrim("services"."name")) >= 2),
	CONSTRAINT "services_default_price" CHECK ("services"."default_price_minor" IS NULL OR "services"."default_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"changes" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_amendments_reason" CHECK (length(btrim("subscription_amendments"."reason")) >= 3)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"status" "subscription_status" DEFAULT 'DRAFT' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"renewal_date" date,
	"notice_period_days" integer DEFAULT 30 NOT NULL,
	"billing_cadence" "billing_cadence" NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'GHS' NOT NULL,
	"pricing_basis" "pricing_basis" DEFAULT 'FIXED' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"payment_terms" text,
	"owner_id" uuid NOT NULL,
	"renewal_owner_id" uuid,
	"external_reference" text,
	"notes" text,
	"status_reason" text,
	"ended_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_price" CHECK ("subscriptions"."price_minor" >= 0),
	CONSTRAINT "subscriptions_quantity" CHECK ("subscriptions"."quantity" >= 1),
	CONSTRAINT "subscriptions_notice" CHECK ("subscriptions"."notice_period_days" BETWEEN 0 AND 365),
	CONSTRAINT "subscriptions_end_after_start" CHECK ("subscriptions"."end_date" IS NULL OR "subscriptions"."end_date" >= "subscriptions"."start_date"),
	CONSTRAINT "subscriptions_renewal_in_term" CHECK ("subscriptions"."renewal_date" IS NULL OR ("subscriptions"."renewal_date" >= "subscriptions"."start_date" AND ("subscriptions"."end_date" IS NULL OR "subscriptions"."renewal_date" <= "subscriptions"."end_date"))),
	CONSTRAINT "subscriptions_ended_matches_status" CHECK (("subscriptions"."status" IN ('ENDED', 'CANCELLED')) = ("subscriptions"."ended_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_amendments" ADD CONSTRAINT "subscription_amendments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_amendments" ADD CONSTRAINT "subscription_amendments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_renewal_owner_id_users_id_fk" FOREIGN KEY ("renewal_owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "services_code_unique" ON "services" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "subscription_amendments_subscription_idx" ON "subscription_amendments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_customer_idx" ON "subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_service_idx" ON "subscriptions" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "subscriptions_renewal_idx" ON "subscriptions" USING btree ("renewal_date");