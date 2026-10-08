-- Rules for Phase 33 (the jobs board and the team finder). Like the other community tables: shared
-- by the whole platform, no app-role access; the server reads and writes them after its own checks
-- (src/modules/community).

REVOKE ALL ON community_jobs, job_applications, team_posts, team_requests FROM agod_app;
--> statement-breakpoint
ALTER TABLE community_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE team_posts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE team_requests ENABLE ROW LEVEL SECURITY;
