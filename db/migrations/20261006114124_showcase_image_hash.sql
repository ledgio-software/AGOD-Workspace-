ALTER TABLE "showcase_images" ADD COLUMN "sha256" text;--> statement-breakpoint
CREATE INDEX "showcase_images_sha256_idx" ON "showcase_images" USING btree ("sha256");--> statement-breakpoint
ALTER TABLE "showcase_images" ADD CONSTRAINT "showcase_images_sha256" CHECK ("showcase_images"."sha256" IS NULL OR "showcase_images"."sha256" ~ '^[0-9a-f]{64}$');