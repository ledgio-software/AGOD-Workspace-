-- Members may see who is on a project and in which role, but not other members' splits
-- (design doc section 4: members view only their own payout records).
DROP POLICY assignments_select ON project_assignments;
--> statement-breakpoint
CREATE POLICY assignments_select ON project_assignments FOR SELECT TO agod_app
  USING (app_is_manager() OR (member_id = app_user_id() AND app_user_role() IS NOT NULL));
--> statement-breakpoint
-- Team list without compensation, for anyone who can view the project.
CREATE FUNCTION app_project_team(pid uuid)
  RETURNS TABLE (assignment_id uuid, member_id uuid, member_name text, role_on_project text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT a.id, a.member_id, u.name, a.role_on_project
    FROM project_assignments a
    JOIN users u ON u.id = a.member_id
    WHERE a.project_id = pid AND a.active AND app_can_view_project(pid)
    ORDER BY a.created_at
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_project_team(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_project_team(uuid) TO agod_app;
