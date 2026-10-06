-- Rules for Phase 24 (Google Calendar). calendar_events maps app items to Google event ids, like
-- drive_folders: no access for the app role. Project meetings are visible with their project and
-- scheduled or cancelled by managers. Both stay inside their company (Phase 22).
REVOKE ALL ON calendar_events FROM agod_app;
--> statement-breakpoint
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendar_events_tenant ON calendar_events AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER calendar_events_same_org BEFORE INSERT OR UPDATE ON calendar_events FOR EACH ROW EXECUTE FUNCTION app_same_org('connection_id:google_connections');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON project_meetings TO agod_app;
--> statement-breakpoint
ALTER TABLE project_meetings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_meetings_tenant ON project_meetings AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY project_meetings_select ON project_meetings FOR SELECT TO agod_app USING (app_can_view_project(project_id));
--> statement-breakpoint
CREATE POLICY project_meetings_insert ON project_meetings FOR INSERT TO agod_app
  WITH CHECK (app_is_manager() AND created_by = app_user_id() AND cancelled_at IS NULL);
--> statement-breakpoint
CREATE POLICY project_meetings_update ON project_meetings FOR UPDATE TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE TRIGGER project_meetings_same_org BEFORE INSERT OR UPDATE ON project_meetings FOR EACH ROW
  EXECUTE FUNCTION app_same_org('project_id:projects', 'created_by:member', 'cancelled_by:member');
--> statement-breakpoint
-- Meetings are cancelled, never deleted; after scheduling only the Google details and the
-- cancellation are filled in, and a cancelled meeting no longer changes.
CREATE FUNCTION project_meetings_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Meetings are cancelled, not deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'A cancelled meeting cannot be changed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (to_jsonb(NEW) - 'google_event_id' - 'meet_url' - 'cancelled_at' - 'cancelled_by' - 'updated_at')
       <> (to_jsonb(OLD) - 'google_event_id' - 'meet_url' - 'cancelled_at' - 'cancelled_by' - 'updated_at') THEN
      RAISE EXCEPTION 'A meeting can only be cancelled; schedule a new one to change it' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER project_meetings_guard BEFORE UPDATE OR DELETE ON project_meetings FOR EACH ROW EXECUTE FUNCTION project_meetings_guard();
