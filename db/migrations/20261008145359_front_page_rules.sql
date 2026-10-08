-- Rules for Phase 35 (community front page photos and welcome video). Like the other community
-- tables: no app-role access; the server reads and writes them after its own checks.

REVOKE ALL ON front_photos, community_settings FROM agod_app;
--> statement-breakpoint
ALTER TABLE front_photos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE community_settings ENABLE ROW LEVEL SECURITY;
