-- Row-level security: the database-side copy of src/lib/permissions.
--
-- The app connects as the database owner (used by Better Auth, migrations and scripts).
-- All domain queries run through withActor(), which does `SET LOCAL ROLE agod_app` and
-- `set_config('app.user_id', ...)`. agod_app has no BYPASSRLS, so the policies below apply.
-- RLS is ENABLEd, not FORCEd, so the owner connection used by Better Auth is unaffected.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agod_app') THEN
    CREATE ROLE agod_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT agod_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO agod_app;
--> statement-breakpoint

-- Helpers. The role is read from users by id (never trusted from the session variable),
-- and inactive users get no role at all.
CREATE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT role::text FROM users WHERE id = app_user_id() AND active $$;
--> statement-breakpoint
CREATE FUNCTION app_is_manager() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(app_user_role() IN ('PROJECT_MANAGER', 'ADMIN'), false) $$;
--> statement-breakpoint
CREATE FUNCTION app_is_admin() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(app_user_role() = 'ADMIN', false) $$;
--> statement-breakpoint
-- SECURITY DEFINER so the membership lookup is not itself filtered by RLS (no policy recursion).
CREATE FUNCTION app_can_view_project(pid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT app_is_manager()
      OR (app_user_role() IS NOT NULL AND (
        EXISTS (SELECT 1 FROM projects p WHERE p.id = pid AND p.project_owner_id = app_user_id())
        OR EXISTS (SELECT 1 FROM project_assignments a
                   WHERE a.project_id = pid AND a.member_id = app_user_id() AND a.active)
        OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = pid AND t.assigned_to = app_user_id())
      ))
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_user_role(), app_can_view_project(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_user_id(), app_user_role(), app_is_manager(), app_is_admin(),
  app_can_view_project(uuid) TO agod_app;
--> statement-breakpoint

-- Table privileges for agod_app. There is deliberately no DELETE on any domain table:
-- financial history is archived or corrected, never deleted.
GRANT SELECT, INSERT, UPDATE ON users TO agod_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON accounts TO agod_app;
--> statement-breakpoint
GRANT SELECT, DELETE ON sessions TO agod_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON projects, project_assignments, milestones, tasks,
  payout_ledger_entries, notifications TO agod_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON compensation_snapshots, compensation_snapshot_lines,
  payment_transactions, adjustments, audit_events TO agod_app;
--> statement-breakpoint

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE compensation_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE compensation_snapshot_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payout_ledger_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE adjustments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Identity: everyone signed in can see team members (names appear in history);
-- only Admins create or change accounts and revoke sessions.
CREATE POLICY users_select ON users FOR SELECT TO agod_app USING (app_user_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY users_insert ON users FOR INSERT TO agod_app WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY users_update ON users FOR UPDATE TO agod_app USING (app_is_admin()) WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY accounts_admin ON accounts FOR ALL TO agod_app USING (app_is_admin()) WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY sessions_admin ON sessions FOR ALL TO agod_app USING (app_is_admin());
--> statement-breakpoint

-- Projects and work: visible to managers and to members of the project; managers write.
CREATE POLICY projects_select ON projects FOR SELECT TO agod_app USING (app_can_view_project(id));
--> statement-breakpoint
CREATE POLICY projects_insert ON projects FOR INSERT TO agod_app WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY projects_update ON projects FOR UPDATE TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY assignments_select ON project_assignments FOR SELECT TO agod_app USING (app_can_view_project(project_id));
--> statement-breakpoint
CREATE POLICY assignments_insert ON project_assignments FOR INSERT TO agod_app WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY assignments_update ON project_assignments FOR UPDATE TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY milestones_select ON milestones FOR SELECT TO agod_app USING (app_can_view_project(project_id));
--> statement-breakpoint
CREATE POLICY milestones_insert ON milestones FOR INSERT TO agod_app WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY milestones_update ON milestones FOR UPDATE TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY tasks_select ON tasks FOR SELECT TO agod_app USING (app_can_view_project(project_id));
--> statement-breakpoint
CREATE POLICY tasks_insert ON tasks FOR INSERT TO agod_app WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY tasks_update ON tasks FOR UPDATE TO agod_app
  USING (app_is_manager() OR (assigned_to = app_user_id() AND app_user_role() IS NOT NULL))
  WITH CHECK (app_is_manager() OR (assigned_to = app_user_id() AND app_user_role() IS NOT NULL));
--> statement-breakpoint

-- Compensation and ledger: managers see all; members see only their own lines.
CREATE POLICY snapshots_select ON compensation_snapshots FOR SELECT TO agod_app USING (app_can_view_project(project_id));
--> statement-breakpoint
CREATE POLICY snapshots_insert ON compensation_snapshots FOR INSERT TO agod_app WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY snapshot_lines_select ON compensation_snapshot_lines FOR SELECT TO agod_app
  USING (app_is_manager() OR (member_id = app_user_id() AND app_user_role() IS NOT NULL));
--> statement-breakpoint
CREATE POLICY snapshot_lines_insert ON compensation_snapshot_lines FOR INSERT TO agod_app WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY ledger_select ON payout_ledger_entries FOR SELECT TO agod_app
  USING (app_is_manager() OR (member_id = app_user_id() AND app_user_role() IS NOT NULL));
--> statement-breakpoint
CREATE POLICY ledger_insert ON payout_ledger_entries FOR INSERT TO agod_app WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY ledger_update ON payout_ledger_entries FOR UPDATE TO agod_app USING (app_is_admin()) WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY payments_select ON payment_transactions FOR SELECT TO agod_app
  USING (app_is_manager() OR EXISTS (SELECT 1 FROM payout_ledger_entries l WHERE l.id = ledger_entry_id));
--> statement-breakpoint
-- Decision 4: only Admins record payments.
CREATE POLICY payments_insert ON payment_transactions FOR INSERT TO agod_app WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY adjustments_select ON adjustments FOR SELECT TO agod_app
  USING (app_is_manager() OR EXISTS (SELECT 1 FROM payout_ledger_entries l WHERE l.id = ledger_entry_id));
--> statement-breakpoint
CREATE POLICY adjustments_insert ON adjustments FOR INSERT TO agod_app WITH CHECK (app_is_admin());
--> statement-breakpoint

-- Audit: Admins see everything, PMs see history of projects they can view, members their own actions.
-- Anyone signed in appends events only as themselves.
CREATE POLICY audit_select ON audit_events FOR SELECT TO agod_app
  USING (app_is_admin()
    OR (app_is_manager() AND project_id IS NOT NULL AND app_can_view_project(project_id))
    OR (actor_id = app_user_id() AND app_user_role() IS NOT NULL));
--> statement-breakpoint
CREATE POLICY audit_insert ON audit_events FOR INSERT TO agod_app
  WITH CHECK (actor_id = app_user_id() AND app_user_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY notifications_select ON notifications FOR SELECT TO agod_app USING (recipient_id = app_user_id());
--> statement-breakpoint
CREATE POLICY notifications_update ON notifications FOR UPDATE TO agod_app
  USING (recipient_id = app_user_id()) WITH CHECK (recipient_id = app_user_id());
--> statement-breakpoint
CREATE POLICY notifications_insert ON notifications FOR INSERT TO agod_app WITH CHECK (app_user_role() IS NOT NULL);
--> statement-breakpoint

-- Append-only records: no updates or deletes for anyone, including the owner connection.
CREATE FUNCTION reject_modification() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint
CREATE TRIGGER compensation_snapshots_append_only BEFORE UPDATE OR DELETE ON compensation_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint
CREATE TRIGGER compensation_snapshot_lines_append_only BEFORE UPDATE OR DELETE ON compensation_snapshot_lines
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint
CREATE TRIGGER payment_transactions_append_only BEFORE UPDATE OR DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint
CREATE TRIGGER adjustments_append_only BEFORE UPDATE OR DELETE ON adjustments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint

-- Members may change only the progress fields of their own tasks, and cannot waive them.
CREATE FUNCTION tasks_member_update_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF current_user = 'agod_app' AND NOT app_is_manager() THEN
      IF (NEW.project_id, NEW.milestone_id, NEW.title, NEW.description, NEW.assigned_to, NEW.required, NEW.due_date)
         IS DISTINCT FROM
         (OLD.project_id, OLD.milestone_id, OLD.title, OLD.description, OLD.assigned_to, OLD.required, OLD.due_date) THEN
        RAISE EXCEPTION 'Only a project manager can change task details' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.status = 'WAIVED' AND OLD.status IS DISTINCT FROM 'WAIVED' THEN
        RAISE EXCEPTION 'Only a project manager can waive a task' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER tasks_member_update_guard BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_member_update_guard();
