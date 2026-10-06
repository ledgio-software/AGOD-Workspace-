-- Rules for Phase 26 (showcase). Like the other community tables: shared by the whole platform, no
-- app-role access; the server reads and writes them after its own checks (src/modules/community).

REVOKE ALL ON showcase_posts, showcase_images, showcase_reviews FROM agod_app;
--> statement-breakpoint
ALTER TABLE showcase_posts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE showcase_images ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE showcase_reviews ENABLE ROW LEVEL SECURITY;
