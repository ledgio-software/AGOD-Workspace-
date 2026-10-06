ALTER TABLE "invoice_settings" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD PRIMARY KEY ("organization_id");
