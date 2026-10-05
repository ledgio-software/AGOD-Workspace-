CREATE TYPE "public"."attachment_kind" AS ENUM('PROJECT', 'TASK', 'PAYMENT');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"payment_id" uuid,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_target_matches_kind" CHECK (("attachments"."kind" = 'PROJECT' AND "attachments"."task_id" IS NULL AND "attachments"."payment_id" IS NULL)
       OR ("attachments"."kind" = 'TASK' AND "attachments"."task_id" IS NOT NULL AND "attachments"."payment_id" IS NULL)
       OR ("attachments"."kind" = 'PAYMENT' AND "attachments"."payment_id" IS NOT NULL AND "attachments"."task_id" IS NULL)),
	CONSTRAINT "attachments_size" CHECK ("attachments"."size_bytes" > 0 AND "attachments"."size_bytes" <= 4194304),
	CONSTRAINT "attachments_removed_pair" CHECK (("attachments"."removed_at" IS NULL) = ("attachments"."removed_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_payment_id_payment_transactions_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_project_idx" ON "attachments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "attachments_task_idx" ON "attachments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "attachments_payment_idx" ON "attachments" USING btree ("payment_id");