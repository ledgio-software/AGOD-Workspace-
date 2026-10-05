ALTER TABLE "compensation_snapshots" DROP CONSTRAINT "compensation_snapshots_project_id_unique";--> statement-breakpoint
ALTER TABLE "compensation_snapshots" ADD COLUMN "sequence" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "compensation_snapshots_project_sequence_unique" ON "compensation_snapshots" USING btree ("project_id","sequence");