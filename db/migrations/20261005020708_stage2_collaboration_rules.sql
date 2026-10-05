-- Rules for Phase 7 (roadmap Stage 2, part 1): comments, templates, task estimates.

GRANT SELECT, INSERT ON comments TO agod_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON project_templates TO agod_app;
--> statement-breakpoint
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Comments: anyone who can see the project reads and writes its discussion, as themselves.
CREATE POLICY comments_select ON comments FOR SELECT TO agod_app USING (app_can_view_project(project_id));
--> statement-breakpoint
CREATE POLICY comments_insert ON comments FOR INSERT TO agod_app
  WITH CHECK (author_id = app_user_id() AND app_user_role() IS NOT NULL AND app_can_view_project(project_id));
--> statement-breakpoint
CREATE TRIGGER comments_append_only BEFORE UPDATE OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint
-- A comment about a task must be on that task's project.
CREATE FUNCTION comments_task_matches_project() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  BEGIN
    IF NEW.task_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM tasks t WHERE t.id = NEW.task_id AND t.project_id = NEW.project_id
    ) THEN
      RAISE EXCEPTION 'That task is not part of this project' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER comments_task_matches_project BEFORE INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION comments_task_matches_project();
--> statement-breakpoint

-- Templates: managers read and maintain them. No deletes; deactivate instead.
CREATE POLICY project_templates_select ON project_templates FOR SELECT TO agod_app USING (app_is_manager());
--> statement-breakpoint
CREATE POLICY project_templates_insert ON project_templates FOR INSERT TO agod_app WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY project_templates_update ON project_templates FOR UPDATE TO agod_app
  USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint

-- Members may not change the estimate of their own task (extends the guard in *_row_level_security.sql).
CREATE OR REPLACE FUNCTION tasks_member_update_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF current_user = 'agod_app' AND NOT app_is_manager() THEN
      IF (NEW.project_id, NEW.milestone_id, NEW.title, NEW.description, NEW.assigned_to, NEW.required, NEW.due_date, NEW.estimate_hours)
         IS DISTINCT FROM
         (OLD.project_id, OLD.milestone_id, OLD.title, OLD.description, OLD.assigned_to, OLD.required, OLD.due_date, OLD.estimate_hours) THEN
        RAISE EXCEPTION 'Only a project manager can change task details' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.status = 'WAIVED' AND OLD.status IS DISTINCT FROM 'WAIVED' THEN
        RAISE EXCEPTION 'Only a project manager can waive a task' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint

-- Starter templates for the project types in the roadmap (2.7). Format: "# Milestone", then
-- "- Task | +days | hours | optional" (every part after the title is optional).
INSERT INTO project_templates (name, description, outline) VALUES
('Discovery / research', 'Short research engagement ending in a recommendation.',
'# Understand
- Kick-off meeting and goals | +2d | 2h
- Stakeholder interviews | +7d | 12h
- Review existing systems and data | +7d | 8h
# Recommend
- Findings and options document | +12d | 12h
- Presentation to the client | +14d | 3h'),
('Website', 'Marketing or company website from design to launch.',
'# Design
- Sitemap and content plan | +5d | 6h
- Wireframes | +10d | 12h
- Visual design | +15d | 16h
# Build
- Page templates | +25d | 24h
- Content entry | +28d | 8h
- Contact form and analytics | +28d | 4h
# Launch
- Cross-browser and mobile testing | +32d | 6h
- Domain, hosting and go-live | +35d | 3h
- Handover and training | +37d | 2h | optional'),
('Mobile app', 'iOS/Android app from requirements to store release.',
'# Plan
- Requirements and user stories | +7d | 12h
- UX flows and screens | +14d | 20h
# Build
- App shell, navigation and auth | +28d | 32h
- Core features | +45d | 80h
- API integration | +45d | 24h
# Release
- QA on real devices | +52d | 16h
- Store listings and submission | +56d | 6h
- Release monitoring | +63d | 4h | optional'),
('AI integration', 'Adding an AI feature to an existing product.',
'# Explore
- Use case and success criteria | +3d | 4h
- Data and privacy review | +7d | 6h
- Prototype and evaluation set | +14d | 20h
# Build
- Production integration | +28d | 32h
- Guardrails, logging and cost limits | +30d | 12h
# Launch
- Evaluation against success criteria | +33d | 8h
- Rollout and monitoring | +35d | 4h'),
('Internal product feature', 'A feature for an AGOD product (e.g. Ledgio).',
'# Specify
- Problem statement and acceptance criteria | +3d | 3h
- Design review | +5d | 4h
# Deliver
- Implementation | +15d | 32h
- Tests | +17d | 8h
- Code review and fixes | +18d | 4h
- Staging verification by PM | +19d | 2h
- Release notes | +20d | 1h | optional'),
('Maintenance / support', 'Recurring support period for an existing client system.',
'- Monthly health check | +7d | 3h
- Dependency and security updates | +14d | 6h
- Backups verified | +14d | 1h
- Support tickets | +28d | 12h
- Monthly report to the client | +30d | 2h')
ON CONFLICT (name) DO NOTHING;
