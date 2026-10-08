-- Rules for Phase 31 (mentorship, the tools & prompts library, project of the month). Like the
-- other community tables: shared by the whole platform, no app-role access; the server reads and
-- writes them after its own checks (src/modules/community).

REVOKE ALL ON mentorships, library_items, library_votes, project_votes, project_of_month FROM agod_app;
--> statement-breakpoint
ALTER TABLE mentorships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE library_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE library_votes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_votes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_of_month ENABLE ROW LEVEL SECURITY;
