-- Rules for Phase 8 (GitHub integration). The webhook writes through the owner connection as
-- the system (like migrations and scripts); people only read GitHub data and add or remove links.

-- Task numbers: the next free number in the project, set before insert (the project row is
-- locked by every app path that creates tasks, so numbers do not collide).
CREATE FUNCTION tasks_assign_number() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  BEGIN
    IF NEW.number IS NULL OR NEW.number = 0 THEN
      SELECT coalesce(max(number), 0) + 1 INTO NEW.number FROM tasks WHERE project_id = NEW.project_id;
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER tasks_assign_number BEFORE INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_assign_number();
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_number_positive CHECK (number > 0);
--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON task_links TO agod_app;
--> statement-breakpoint
GRANT SELECT ON github_deployments, github_releases, github_deliveries TO agod_app;
--> statement-breakpoint
ALTER TABLE task_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE github_deployments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE github_releases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE github_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Links: visible with the project. Managers link any task; members link their own tasks. Only
-- managers remove a link. Links point at GitHub, so they carry no money or private data.
CREATE POLICY task_links_select ON task_links FOR SELECT TO agod_app USING (app_can_view_project(project_id));
--> statement-breakpoint
CREATE POLICY task_links_insert ON task_links FOR INSERT TO agod_app
  WITH CHECK (
    linked_by = app_user_id() AND app_user_role() IS NOT NULL
    AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.project_id = task_links.project_id
                AND (app_is_manager() OR t.assigned_to = app_user_id()))
  );
--> statement-breakpoint
CREATE POLICY task_links_delete ON task_links FOR DELETE TO agod_app USING (app_is_manager());
--> statement-breakpoint

-- Deployments and releases describe the code, not people or money: anyone signed in may read them.
CREATE POLICY github_deployments_select ON github_deployments FOR SELECT TO agod_app USING (app_user_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY github_releases_select ON github_releases FOR SELECT TO agod_app USING (app_user_role() IS NOT NULL);
--> statement-breakpoint
-- The delivery log is for Admins checking the integration.
CREATE POLICY github_deliveries_select ON github_deliveries FOR SELECT TO agod_app USING (app_is_admin());
