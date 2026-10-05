ALTER TABLE "compensation_snapshots" ADD COLUMN "agod_share_basis_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "compensation_snapshots" ADD COLUMN "agod_share_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "agod_share_basis_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_agod_share_valid" CHECK ("projects"."agod_share_basis_points" BETWEEN 0 AND 10000 AND ("projects"."split_mode" = 'PERCENTAGE' OR "projects"."agod_share_basis_points" = 0));