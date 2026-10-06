-- Rules for Phase 27 (teaching sessions): platform-wide and server-only, like the other community
-- tables (src/modules/community/sessions.ts checks who may see and change what).

REVOKE ALL ON community_sessions, community_session_attendees FROM agod_app;
--> statement-breakpoint
ALTER TABLE community_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE community_session_attendees ENABLE ROW LEVEL SECURITY;
