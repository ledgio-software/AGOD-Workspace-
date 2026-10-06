-- Phase 22: keeping companies apart. Every company-owned table has organization_id (filled
-- from app.org_id, which withActor sets from the person's current company). For the app role:
--   1. a RESTRICTIVE policy on each such table: rows of other companies are invisible and can't
--      be written, whatever the other (permissive) policies allow;
--   2. roles come from the person's membership in the current company (app_user_role);
--   3. a trigger refuses references to another company's records or to people who aren't members.
-- Functions that bypass row-level security (SECURITY DEFINER) check the company themselves.
GRANT EXECUTE ON FUNCTION app_org_id() TO agod_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT m.role::text FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.user_id = app_user_id() AND m.organization_id = app_org_id() AND m.active AND u.active
  $$;
--> statement-breakpoint
-- app_can_view_project stays as it was: row-level security on each table already limits rows to
-- the current company. The SECURITY DEFINER functions built on it check the company themselves.
CREATE OR REPLACE FUNCTION app_project_team(pid uuid)
  RETURNS TABLE (assignment_id uuid, member_id uuid, member_name text, role_on_project text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT a.id, a.member_id, u.name, a.role_on_project
    FROM project_assignments a
    JOIN users u ON u.id = a.member_id
    WHERE a.project_id = pid AND a.active AND app_can_view_project(pid)
      AND EXISTS (SELECT 1 FROM projects p WHERE p.id = pid AND p.organization_id = app_org_id())
    ORDER BY a.created_at
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_request_approval(pid uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    current_status project_status;
  BEGIN
    IF NOT app_can_view_project(pid) OR NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = pid AND p.organization_id = app_org_id()) THEN
      RAISE EXCEPTION 'Project not found' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT status INTO current_status FROM projects WHERE id = pid FOR UPDATE;
    IF current_status NOT IN ('IN_PROGRESS', 'CHANGES_REQUESTED') THEN
      RAISE EXCEPTION 'Approval can only be requested for a project that is in progress' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE projects SET status = 'PENDING_APPROVAL', version = version + 1, updated_at = now() WHERE id = pid;
  END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ledger_balance(entry_id uuid)
  RETURNS TABLE (effective_owed bigint, paid bigint, voided boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT
      l.amount_owed_minor + coalesce((
        SELECT sum(CASE a.type WHEN 'INCREASE' THEN a.amount_minor WHEN 'VOID' THEN 0 ELSE -a.amount_minor END)
        FROM adjustments a WHERE a.ledger_entry_id = l.id), 0)::bigint,
      coalesce((SELECT sum(p.amount_minor) FROM payment_transactions p WHERE p.ledger_entry_id = l.id), 0)::bigint,
      l.status = 'VOIDED' OR EXISTS (SELECT 1 FROM adjustments a WHERE a.ledger_entry_id = l.id AND a.type = 'VOID')
    FROM payout_ledger_entries l
    WHERE l.id = entry_id AND l.organization_id = app_org_id()
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_period_locked(ts timestamptz) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM payout_periods p WHERE p.organization_id = app_org_id() AND p.period = app_period_of(ts) AND p.locked) $$;
--> statement-breakpoint
-- References must stay inside the company: TG_ARGV lists "column:table" (or "column:member" for
-- people, who must have a membership in the row's company).
CREATE FUNCTION app_same_org() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    i int;
    col text;
    target text;
    val uuid;
    old_val uuid;
    owner_org uuid;
  BEGIN
    FOR i IN 0 .. TG_NARGS - 1 LOOP
      col := split_part(TG_ARGV[i], ':', 1);
      target := split_part(TG_ARGV[i], ':', 2);
      EXECUTE format('SELECT ($1).%I::uuid', col) INTO val USING NEW;
      CONTINUE WHEN val IS NULL;
      IF TG_OP = 'UPDATE' THEN
        EXECUTE format('SELECT ($1).%I::uuid', col) INTO old_val USING OLD;
        CONTINUE WHEN old_val = val AND OLD.organization_id = NEW.organization_id;
      END IF;
      IF target = 'member' THEN
        IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = val AND m.organization_id = NEW.organization_id) THEN
          RAISE EXCEPTION 'That person is not a member of this company (%)', col USING ERRCODE = 'check_violation';
        END IF;
      ELSE
        EXECUTE format('SELECT organization_id FROM %I WHERE id = $1', target) INTO owner_org USING val;
        IF owner_org IS DISTINCT FROM NEW.organization_id THEN
          RAISE EXCEPTION 'That record belongs to another company (%)', col USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END LOOP;
    RETURN NEW;
  END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_same_org() FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY adjustments_tenant ON adjustments AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER adjustments_same_org BEFORE INSERT OR UPDATE ON adjustments FOR EACH ROW EXECUTE FUNCTION app_same_org('ledger_entry_id:payout_ledger_entries', 'created_by:member', 'approved_by:member');
--> statement-breakpoint
CREATE POLICY attachments_tenant ON attachments AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER attachments_same_org BEFORE INSERT OR UPDATE ON attachments FOR EACH ROW EXECUTE FUNCTION app_same_org('project_id:projects', 'task_id:tasks', 'payment_id:payment_transactions', 'uploaded_by:member', 'removed_by:member');
--> statement-breakpoint
CREATE POLICY audit_events_tenant ON audit_events AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER audit_events_same_org BEFORE INSERT OR UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION app_same_org('actor_id:member', 'project_id:projects');
--> statement-breakpoint
CREATE POLICY comments_tenant ON comments AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER comments_same_org BEFORE INSERT OR UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION app_same_org('project_id:projects', 'task_id:tasks', 'author_id:member');
--> statement-breakpoint
CREATE POLICY compensation_snapshot_lines_tenant ON compensation_snapshot_lines AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER compensation_snapshot_lines_same_org BEFORE INSERT OR UPDATE ON compensation_snapshot_lines FOR EACH ROW EXECUTE FUNCTION app_same_org('snapshot_id:compensation_snapshots', 'member_id:member', 'source_assignment_id:project_assignments');
--> statement-breakpoint
CREATE POLICY compensation_snapshots_tenant ON compensation_snapshots AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER compensation_snapshots_same_org BEFORE INSERT OR UPDATE ON compensation_snapshots FOR EACH ROW EXECUTE FUNCTION app_same_org('project_id:projects', 'created_by:member');
--> statement-breakpoint
CREATE POLICY customer_contacts_tenant ON customer_contacts AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER customer_contacts_same_org BEFORE INSERT OR UPDATE ON customer_contacts FOR EACH ROW EXECUTE FUNCTION app_same_org('customer_id:customers');
--> statement-breakpoint
CREATE POLICY customers_tenant ON customers AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER customers_same_org BEFORE INSERT OR UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION app_same_org('owner_id:member', 'created_by:member');
--> statement-breakpoint
CREATE POLICY drive_folders_tenant ON drive_folders AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER drive_folders_same_org BEFORE INSERT OR UPDATE ON drive_folders FOR EACH ROW EXECUTE FUNCTION app_same_org('connection_id:google_connections');
--> statement-breakpoint
CREATE POLICY github_deployments_tenant ON github_deployments AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY github_releases_tenant ON github_releases AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY google_connections_tenant ON google_connections AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER google_connections_same_org BEFORE INSERT OR UPDATE ON google_connections FOR EACH ROW EXECUTE FUNCTION app_same_org('user_id:member');
--> statement-breakpoint
CREATE POLICY invoice_lines_tenant ON invoice_lines AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER invoice_lines_same_org BEFORE INSERT OR UPDATE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION app_same_org('invoice_id:invoices', 'subscription_id:subscriptions', 'project_id:projects');
--> statement-breakpoint
CREATE POLICY invoice_payments_tenant ON invoice_payments AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER invoice_payments_same_org BEFORE INSERT OR UPDATE ON invoice_payments FOR EACH ROW EXECUTE FUNCTION app_same_org('invoice_id:invoices', 'recorded_by:member', 'voided_by:member');
--> statement-breakpoint
CREATE POLICY invoice_settings_tenant ON invoice_settings AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER invoice_settings_same_org BEFORE INSERT OR UPDATE ON invoice_settings FOR EACH ROW EXECUTE FUNCTION app_same_org('updated_by:member');
--> statement-breakpoint
CREATE POLICY invoices_tenant ON invoices AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER invoices_same_org BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION app_same_org('customer_id:customers', 'created_by:member', 'issued_by:member', 'voided_by:member');
--> statement-breakpoint
CREATE POLICY job_runs_tenant ON job_runs AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY milestones_tenant ON milestones AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER milestones_same_org BEFORE INSERT OR UPDATE ON milestones FOR EACH ROW EXECUTE FUNCTION app_same_org('project_id:projects');
--> statement-breakpoint
CREATE POLICY notifications_tenant ON notifications AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER notifications_same_org BEFORE INSERT OR UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION app_same_org('recipient_id:member');
--> statement-breakpoint
CREATE POLICY payment_transactions_tenant ON payment_transactions AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER payment_transactions_same_org BEFORE INSERT OR UPDATE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION app_same_org('ledger_entry_id:payout_ledger_entries', 'recorded_by:member');
--> statement-breakpoint
CREATE POLICY payout_ledger_entries_tenant ON payout_ledger_entries AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER payout_ledger_entries_same_org BEFORE INSERT OR UPDATE ON payout_ledger_entries FOR EACH ROW EXECUTE FUNCTION app_same_org('project_id:projects', 'snapshot_line_id:compensation_snapshot_lines', 'member_id:member', 'approved_by:member');
--> statement-breakpoint
CREATE POLICY payout_periods_tenant ON payout_periods AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER payout_periods_same_org BEFORE INSERT OR UPDATE ON payout_periods FOR EACH ROW EXECUTE FUNCTION app_same_org('locked_by:member', 'unlocked_by:member');
--> statement-breakpoint
CREATE POLICY payout_questions_tenant ON payout_questions AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER payout_questions_same_org BEFORE INSERT OR UPDATE ON payout_questions FOR EACH ROW EXECUTE FUNCTION app_same_org('ledger_entry_id:payout_ledger_entries', 'project_id:projects', 'raised_by:member', 'reviewed_by:member', 'resolved_by:member', 'adjustment_id:adjustments');
--> statement-breakpoint
CREATE POLICY project_assignments_tenant ON project_assignments AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER project_assignments_same_org BEFORE INSERT OR UPDATE ON project_assignments FOR EACH ROW EXECUTE FUNCTION app_same_org('project_id:projects', 'member_id:member');
--> statement-breakpoint
CREATE POLICY project_costs_tenant ON project_costs AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER project_costs_same_org BEFORE INSERT OR UPDATE ON project_costs FOR EACH ROW EXECUTE FUNCTION app_same_org('project_id:projects', 'created_by:member', 'voided_by:member');
--> statement-breakpoint
CREATE POLICY project_links_tenant ON project_links AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER project_links_same_org BEFORE INSERT OR UPDATE ON project_links FOR EACH ROW EXECUTE FUNCTION app_same_org('project_id:projects', 'task_id:tasks', 'added_by:member', 'removed_by:member');
--> statement-breakpoint
CREATE POLICY project_templates_tenant ON project_templates AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER project_templates_same_org BEFORE INSERT OR UPDATE ON project_templates FOR EACH ROW EXECUTE FUNCTION app_same_org('created_by:member');
--> statement-breakpoint
CREATE POLICY projects_tenant ON projects AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER projects_same_org BEFORE INSERT OR UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION app_same_org('customer_id:customers', 'project_owner_id:member', 'created_by:member', 'approved_by:member', 'health_override_by:member');
--> statement-breakpoint
CREATE POLICY services_tenant ON services AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER services_same_org BEFORE INSERT OR UPDATE ON services FOR EACH ROW EXECUTE FUNCTION app_same_org('created_by:member');
--> statement-breakpoint
CREATE POLICY subscription_amendments_tenant ON subscription_amendments AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER subscription_amendments_same_org BEFORE INSERT OR UPDATE ON subscription_amendments FOR EACH ROW EXECUTE FUNCTION app_same_org('subscription_id:subscriptions', 'created_by:member');
--> statement-breakpoint
CREATE POLICY subscriptions_tenant ON subscriptions AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER subscriptions_same_org BEFORE INSERT OR UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION app_same_org('customer_id:customers', 'service_id:services', 'owner_id:member', 'renewal_owner_id:member', 'created_by:member');
--> statement-breakpoint
CREATE POLICY task_links_tenant ON task_links AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER task_links_same_org BEFORE INSERT OR UPDATE ON task_links FOR EACH ROW EXECUTE FUNCTION app_same_org('task_id:tasks', 'project_id:projects', 'linked_by:member');
--> statement-breakpoint
CREATE POLICY tasks_tenant ON tasks AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE TRIGGER tasks_same_org BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION app_same_org('project_id:projects', 'milestone_id:milestones', 'assigned_to:member', 'completed_by:member');
--> statement-breakpoint
GRANT SELECT, UPDATE ON organizations TO agod_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON memberships TO agod_app;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organizations_select ON organizations FOR SELECT TO agod_app USING (id = app_org_id() AND app_user_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY organizations_update ON organizations FOR UPDATE TO agod_app USING (id = app_org_id() AND app_is_admin()) WITH CHECK (id = app_org_id() AND app_is_admin());
--> statement-breakpoint
CREATE FUNCTION organizations_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.id <> OLD.id OR NEW.slug <> OLD.slug OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'Only a company''s name and project code prefix can be changed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER organizations_guard BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION organizations_guard();
--> statement-breakpoint
CREATE POLICY memberships_tenant ON memberships AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY memberships_select ON memberships FOR SELECT TO agod_app USING (app_user_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY memberships_insert ON memberships FOR INSERT TO agod_app WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY memberships_update ON memberships FOR UPDATE TO agod_app USING (app_is_admin()) WITH CHECK (app_is_admin());
--> statement-breakpoint
-- A membership never moves to another person or company, and every company keeps at least one
-- active Admin.
CREATE FUNCTION memberships_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Memberships are deactivated, not deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.organization_id <> OLD.organization_id OR NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'A membership cannot move to another person or company' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.role = 'ADMIN' AND OLD.active AND NOT (NEW.role = 'ADMIN' AND NEW.active)
       AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = OLD.organization_id AND m.id <> OLD.id AND m.role = 'ADMIN' AND m.active) THEN
      RAISE EXCEPTION 'A company needs at least one active Admin' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER memberships_guard BEFORE UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION memberships_guard();
--> statement-breakpoint
-- The current company's people, with their role here (Phase 22). Runs with the caller's rights.
CREATE VIEW org_members WITH (security_invoker = true) AS
  SELECT u.id, u.name, u.email, u.phone, m.role, (m.active AND u.active) AS active, m.weekly_capacity_hours, u.created_at
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.organization_id = app_org_id();
--> statement-breakpoint
GRANT SELECT ON org_members TO agod_app;
--> statement-breakpoint
-- People: visible to the companies they belong to. A login's own details are changed only by
-- that person; roles and deactivation are on memberships now.
DROP POLICY users_select ON users;
--> statement-breakpoint
CREATE POLICY users_select ON users FOR SELECT TO agod_app
  USING (app_user_role() IS NOT NULL AND (id = app_user_id()
    OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.organization_id = app_org_id())));
--> statement-breakpoint
DROP POLICY users_update ON users;
--> statement-breakpoint
REVOKE UPDATE ON users FROM agod_app;
--> statement-breakpoint
GRANT UPDATE (name, phone, image, updated_at) ON users TO agod_app;
--> statement-breakpoint
CREATE POLICY users_update ON users FOR UPDATE TO agod_app USING (id = app_user_id()) WITH CHECK (id = app_user_id());
--> statement-breakpoint
-- An Admin may only manage the login (password, sessions) of someone who belongs to no other
-- company: otherwise one company could take over an account another company relies on.
CREATE FUNCTION app_manages_login(uid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT app_is_admin()
      AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = uid AND m.organization_id = app_org_id())
      AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = uid AND m.organization_id <> app_org_id())
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_manages_login(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_manages_login(uuid) TO agod_app;
--> statement-breakpoint
DROP POLICY accounts_admin ON accounts;
--> statement-breakpoint
CREATE POLICY accounts_admin ON accounts FOR ALL TO agod_app USING (app_manages_login(user_id)) WITH CHECK (app_manages_login(user_id));
--> statement-breakpoint
DROP POLICY sessions_admin ON sessions;
--> statement-breakpoint
CREATE POLICY sessions_admin ON sessions FOR ALL TO agod_app
  USING (app_is_admin() AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = sessions.user_id AND m.organization_id = app_org_id()));
