CREATE TABLE "community_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poster_id" uuid NOT NULL,
	"hirer" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"work_mode" text NOT NULL,
	"location" text,
	"pay_min_minor" bigint,
	"pay_max_minor" bigint,
	"pay_unit" text,
	"currency" char(3) DEFAULT 'GHS' NOT NULL,
	"description" text NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"closes_on" date NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_jobs_kind" CHECK ("community_jobs"."kind" IN ('JOB', 'GIG', 'INTERNSHIP')),
	CONSTRAINT "community_jobs_mode" CHECK ("community_jobs"."work_mode" IN ('REMOTE', 'ONSITE', 'HYBRID')),
	CONSTRAINT "community_jobs_status" CHECK ("community_jobs"."status" IN ('OPEN', 'CLOSED', 'FILLED')),
	CONSTRAINT "community_jobs_title" CHECK (length(btrim("community_jobs"."title")) BETWEEN 5 AND 120),
	CONSTRAINT "community_jobs_hirer" CHECK (length(btrim("community_jobs"."hirer")) BETWEEN 2 AND 120),
	CONSTRAINT "community_jobs_description" CHECK (length(btrim("community_jobs"."description")) BETWEEN 30 AND 5000),
	CONSTRAINT "community_jobs_location" CHECK ("community_jobs"."location" IS NULL OR length("community_jobs"."location") <= 80),
	CONSTRAINT "community_jobs_skills" CHECK (cardinality("community_jobs"."skills") <= 10),
	CONSTRAINT "community_jobs_pay_stated" CHECK ("community_jobs"."kind" = 'INTERNSHIP' OR "community_jobs"."pay_min_minor" IS NOT NULL),
	CONSTRAINT "community_jobs_pay" CHECK (("community_jobs"."pay_min_minor" IS NULL) = ("community_jobs"."pay_unit" IS NULL) AND ("community_jobs"."pay_min_minor" IS NULL OR "community_jobs"."pay_min_minor" > 0)
        AND ("community_jobs"."pay_max_minor" IS NULL OR ("community_jobs"."pay_min_minor" IS NOT NULL AND "community_jobs"."pay_max_minor" >= "community_jobs"."pay_min_minor"))),
	CONSTRAINT "community_jobs_unit" CHECK ("community_jobs"."pay_unit" IS NULL OR "community_jobs"."pay_unit" IN ('PROJECT', 'MONTH', 'HOUR')),
	CONSTRAINT "community_jobs_closed" CHECK (("community_jobs"."status" = 'OPEN') = ("community_jobs"."closed_at" IS NULL)),
	CONSTRAINT "community_jobs_hidden" CHECK (("community_jobs"."hidden_at" IS NULL) = ("community_jobs"."hidden_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "job_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"message" text NOT NULL,
	"link" text,
	"status" text DEFAULT 'SENT' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_applications_status" CHECK ("job_applications"."status" IN ('SENT', 'SHORTLISTED', 'HIRED', 'DECLINED', 'WITHDRAWN')),
	CONSTRAINT "job_applications_message" CHECK (length(btrim("job_applications"."message")) BETWEEN 20 AND 2000),
	CONSTRAINT "job_applications_link" CHECK ("job_applications"."link" IS NULL OR "job_applications"."link" ~ '^https://[^\s]+$')
);
--> statement-breakpoint
CREATE TABLE "team_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"commitment" text NOT NULL,
	"reward" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_posts_kind" CHECK ("team_posts"."kind" IN ('IDEA', 'JOINING')),
	CONSTRAINT "team_posts_reward" CHECK ("team_posts"."reward" IN ('LEARNING', 'SHARE', 'PAID')),
	CONSTRAINT "team_posts_status" CHECK ("team_posts"."status" IN ('OPEN', 'CLOSED')),
	CONSTRAINT "team_posts_title" CHECK (length(btrim("team_posts"."title")) BETWEEN 5 AND 120),
	CONSTRAINT "team_posts_description" CHECK (length(btrim("team_posts"."description")) BETWEEN 20 AND 3000),
	CONSTRAINT "team_posts_commitment" CHECK (length(btrim("team_posts"."commitment")) BETWEEN 2 AND 80),
	CONSTRAINT "team_posts_lists" CHECK (cardinality("team_posts"."roles") BETWEEN 1 AND 8 AND cardinality("team_posts"."tools") <= 10),
	CONSTRAINT "team_posts_closed" CHECK (("team_posts"."status" = 'OPEN') = ("team_posts"."closed_at" IS NULL)),
	CONSTRAINT "team_posts_hidden" CHECK (("team_posts"."hidden_at" IS NULL) = ("team_posts"."hidden_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "team_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"response_note" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_requests_status" CHECK ("team_requests"."status" IN ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN')),
	CONSTRAINT "team_requests_message" CHECK (length(btrim("team_requests"."message")) BETWEEN 10 AND 1000),
	CONSTRAINT "team_requests_note" CHECK ("team_requests"."response_note" IS NULL OR length("team_requests"."response_note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "community_reports" DROP CONSTRAINT "community_reports_target";--> statement-breakpoint
ALTER TABLE "community_jobs" ADD CONSTRAINT "community_jobs_poster_id_users_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_jobs" ADD CONSTRAINT "community_jobs_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_id_community_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."community_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_posts" ADD CONSTRAINT "team_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_posts" ADD CONSTRAINT "team_posts_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_requests" ADD CONSTRAINT "team_requests_post_id_team_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."team_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_requests" ADD CONSTRAINT "team_requests_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_jobs_poster_idx" ON "community_jobs" USING btree ("poster_id");--> statement-breakpoint
CREATE INDEX "community_jobs_closes_idx" ON "community_jobs" USING btree ("closes_on");--> statement-breakpoint
CREATE UNIQUE INDEX "job_applications_one" ON "job_applications" USING btree ("job_id","applicant_id");--> statement-breakpoint
CREATE INDEX "job_applications_applicant_idx" ON "job_applications" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "team_posts_author_idx" ON "team_posts" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_requests_one" ON "team_requests" USING btree ("post_id","from_id");--> statement-breakpoint
CREATE INDEX "team_requests_from_idx" ON "team_requests" USING btree ("from_id");--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_target" CHECK ("community_reports"."target_type" IN ('PROFILE', 'POST', 'REVIEW', 'SESSION', 'LIBRARY', 'JOB', 'TEAM'));