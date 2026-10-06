-- Rules for Phase 19 (email reminders). Each person reads and sets only their own email choice.
-- Job runs are written by the scheduled job through the owner connection and read by Admins.

GRANT SELECT, INSERT, UPDATE ON notification_preferences TO agod_app;
--> statement-breakpoint
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_preferences_select ON notification_preferences FOR SELECT TO agod_app USING (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY notification_preferences_insert ON notification_preferences FOR INSERT TO agod_app
  WITH CHECK (user_id = app_user_id() AND app_user_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY notification_preferences_update ON notification_preferences FOR UPDATE TO agod_app
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT ON job_runs TO agod_app;
--> statement-breakpoint
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_runs_select ON job_runs FOR SELECT TO agod_app USING (app_is_admin());
