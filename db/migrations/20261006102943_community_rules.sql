-- Rules for Phase 25 (community). Profiles and reports are shared by the whole platform (no
-- company), so company row-level security doesn't apply. The app role gets no access at all; the
-- server reads and writes them through the owner connection after its own checks
-- (src/modules/community), as for the Google tables.

REVOKE ALL ON member_profiles, community_reports FROM agod_app;
--> statement-breakpoint
ALTER TABLE member_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE community_reports ENABLE ROW LEVEL SECURITY;
