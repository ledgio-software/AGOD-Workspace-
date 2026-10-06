-- Rules for Phase 21 (Google Drive). google_connections and drive_folders hold OAuth tokens and
-- Drive ids: the app role gets no access at all; the server reads them through the owner
-- connection after its own permission checks. Project links follow the attachments rules.

REVOKE ALL ON google_connections, drive_folders FROM agod_app;
--> statement-breakpoint
ALTER TABLE google_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE drive_folders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON project_links TO agod_app;
--> statement-breakpoint
ALTER TABLE project_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Visible with the project.
CREATE POLICY project_links_select ON project_links FOR SELECT TO agod_app USING (app_can_view_project(project_id));
--> statement-breakpoint
-- Added as oneself: managers on any project; members only on tasks assigned to them.
CREATE POLICY project_links_insert ON project_links FOR INSERT TO agod_app
  WITH CHECK (
    added_by = app_user_id() AND app_user_role() IS NOT NULL AND removed_at IS NULL
    AND (app_is_manager() OR EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.assigned_to = app_user_id()))
  );
--> statement-breakpoint
-- Removed (soft) by whoever added it or a manager.
CREATE POLICY project_links_update ON project_links FOR UPDATE TO agod_app
  USING (app_is_manager() OR added_by = app_user_id())
  WITH CHECK (app_is_manager() OR added_by = app_user_id());
--> statement-breakpoint
CREATE FUNCTION project_links_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Links cannot be deleted; remove them instead' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = NEW.task_id AND t.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'The task is not part of this project' USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.removed_at IS NOT NULL OR (to_jsonb(NEW) - 'removed_at' - 'removed_by') <> (to_jsonb(OLD) - 'removed_at' - 'removed_by') THEN
      RAISE EXCEPTION 'A link can only be removed, once' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER project_links_guard BEFORE INSERT OR UPDATE OR DELETE ON project_links FOR EACH ROW EXECUTE FUNCTION project_links_guard();
