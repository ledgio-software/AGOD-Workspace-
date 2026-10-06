CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'ISSUED', 'VOID');--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"subscription_id" uuid,
	"period_start" date,
	"period_end" date,
	"project_id" uuid,
	"voided" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_description" CHECK (length(btrim("invoice_lines"."description")) >= 2),
	CONSTRAINT "invoice_lines_quantity" CHECK ("invoice_lines"."quantity" >= 1),
	CONSTRAINT "invoice_lines_price" CHECK ("invoice_lines"."unit_price_minor" >= 0),
	CONSTRAINT "invoice_lines_amount" CHECK ("invoice_lines"."amount_minor" = "invoice_lines"."quantity" * "invoice_lines"."unit_price_minor"),
	CONSTRAINT "invoice_lines_period" CHECK (("invoice_lines"."subscription_id" IS NULL AND "invoice_lines"."period_start" IS NULL AND "invoice_lines"."period_end" IS NULL)
       OR ("invoice_lines"."subscription_id" IS NOT NULL AND "invoice_lines"."period_start" IS NOT NULL AND "invoice_lines"."period_end" IS NOT NULL AND "invoice_lines"."period_end" >= "invoice_lines"."period_start")),
	CONSTRAINT "invoice_lines_one_source" CHECK ("invoice_lines"."subscription_id" IS NULL OR "invoice_lines"."project_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_payments_amount" CHECK ("invoice_payments"."amount_minor" > 0),
	CONSTRAINT "invoice_payments_void_complete" CHECK (("invoice_payments"."voided_at" IS NULL AND "invoice_payments"."voided_by" IS NULL AND "invoice_payments"."void_reason" IS NULL)
       OR ("invoice_payments"."voided_at" IS NOT NULL AND "invoice_payments"."voided_by" IS NOT NULL AND length(btrim(coalesce("invoice_payments"."void_reason", ''))) >= 3))
);
--> statement-breakpoint
CREATE TABLE "invoice_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"business_name" text DEFAULT 'AGOD' NOT NULL,
	"address" text,
	"email" text,
	"phone" text,
	"tax_id" text,
	"payment_instructions" text,
	"footer" text,
	"default_due_days" integer DEFAULT 14 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_settings_singleton" CHECK ("invoice_settings"."id" = 1),
	CONSTRAINT "invoice_settings_due_days" CHECK ("invoice_settings"."default_due_days" BETWEEN 0 AND 120)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"customer_id" uuid NOT NULL,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"issue_date" date,
	"due_date" date,
	"currency" char(3) DEFAULT 'GHS' NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"bill_to_name" text,
	"bill_to_email" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"issued_by" uuid,
	"issued_at" timestamp with time zone,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"sent_at" timestamp with time zone,
	"sent_to" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_number_format" CHECK ("invoices"."number" IS NULL OR "invoices"."number" ~ '^INV-[0-9]{4}-[0-9]{4,}$'),
	CONSTRAINT "invoices_issued_complete" CHECK ("invoices"."status" = 'DRAFT' OR ("invoices"."number" IS NOT NULL AND "invoices"."issue_date" IS NOT NULL AND "invoices"."due_date" IS NOT NULL AND "invoices"."issued_at" IS NOT NULL)),
	CONSTRAINT "invoices_due_after_issue" CHECK ("invoices"."due_date" IS NULL OR "invoices"."issue_date" IS NULL OR "invoices"."due_date" >= "invoices"."issue_date"),
	CONSTRAINT "invoices_amounts" CHECK ("invoices"."total_minor" >= 0 AND "invoices"."paid_minor" >= 0 AND "invoices"."paid_minor" <= "invoices"."total_minor"),
	CONSTRAINT "invoices_paid_at" CHECK (("invoices"."paid_at" IS NOT NULL) = ("invoices"."status" = 'ISSUED' AND "invoices"."paid_minor" = "invoices"."total_minor" AND "invoices"."total_minor" > 0)),
	CONSTRAINT "invoices_void_complete" CHECK (("invoices"."status" = 'VOID') = ("invoices"."voided_at" IS NOT NULL AND "invoices"."voided_by" IS NOT NULL AND length(btrim(coalesce("invoices"."void_reason", ''))) >= 3))
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_project_idx" ON "invoice_lines" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_subscription_period" ON "invoice_lines" USING btree ("subscription_id","period_start") WHERE "invoice_lines"."subscription_id" IS NOT NULL AND NOT "invoice_lines"."voided";--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_status_due_idx" ON "invoices" USING btree ("status","due_date");