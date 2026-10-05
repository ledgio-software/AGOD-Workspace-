CREATE TYPE "public"."github_link_kind" AS ENUM('ISSUE', 'PULL_REQUEST', 'COMMIT', 'BRANCH');--> statement-breakpoint
ALTER TYPE "public"."task_status" ADD VALUE 'IN_REVIEW';--> statement-breakpoint
ALTER TYPE "public"."task_status" ADD VALUE 'READY_FOR_QA';--> statement-breakpoint
CREATE TABLE "github_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"action" text,
	"repo" text,
	"summary" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"repo" text NOT NULL,
	"environment" text NOT NULL,
	"ref" text,
	"sha" text NOT NULL,
	"state" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_deployments_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "github_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"repo" text NOT NULL,
	"tag" text NOT NULL,
	"name" text,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_releases_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "github_link_kind" NOT NULL,
	"repo" text NOT NULL,
	"number" integer,
	"ref" text,
	"key" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"state" text,
	"author_login" text,
	"review_state" text,
	"reviewers" text[] DEFAULT '{}'::text[] NOT NULL,
	"head_sha" text,
	"merge_commit_sha" text,
	"merged_at" timestamp with time zone,
	"linked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_repo" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Number existing tasks per project in creation order, before the unique index below.
UPDATE "tasks" t SET "number" = n.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn FROM "tasks") n
  WHERE n.id = t.id;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_deployments_repo_sha_idx" ON "github_deployments" USING btree ("repo","sha");--> statement-breakpoint
CREATE INDEX "github_releases_repo_idx" ON "github_releases" USING btree ("repo");--> statement-breakpoint
CREATE UNIQUE INDEX "task_links_task_key_unique" ON "task_links" USING btree ("task_id","key");--> statement-breakpoint
CREATE INDEX "task_links_project_idx" ON "task_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_links_repo_number_idx" ON "task_links" USING btree ("repo","number");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_number_unique" ON "tasks" USING btree ("project_id","number");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_github_repo_format" CHECK ("projects"."github_repo" IS NULL OR "projects"."github_repo" ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$');