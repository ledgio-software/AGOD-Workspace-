-- Rules for Phase 28: company-made roles, job titles and "two people for money".
--
-- A company role starts from a base role (Team Member, Project Manager or Admin) and keeps a list
-- of permission groups. The application narrows what the person can do to that list; row-level
-- security keeps enforcing the base role, which the database copies onto the membership.

GRANT SELECT, INSERT, UPDATE ON company_roles, job_titles TO agod_app;
--> statement-breakpoint
ALTER TABLE company_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE job_titles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_roles_tenant ON company_roles AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY company_roles_select ON company_roles FOR SELECT TO agod_app USING (app_user_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY company_roles_insert ON company_roles FOR INSERT TO agod_app WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY company_roles_update ON company_roles FOR UPDATE TO agod_app USING (app_is_admin()) WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY job_titles_tenant ON job_titles AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY job_titles_select ON job_titles FOR SELECT TO agod_app USING (app_user_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY job_titles_insert ON job_titles FOR INSERT TO agod_app WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY job_titles_update ON job_titles FOR UPDATE TO agod_app USING (app_is_admin()) WITH CHECK (app_is_admin());
--> statement-breakpoint
ALTER TABLE company_roles ADD CONSTRAINT company_roles_permissions_known CHECK (permissions <@ ARRAY[
  'projects.manage', 'projects.approve', 'projects.reopen', 'payouts.view', 'payouts.pay', 'team.view',
  'team.manage', 'finance', 'clients', 'invoices', 'invoices.payments', 'company'
]::text[]);
--> statement-breakpoint
CREATE TRIGGER company_roles_same_org BEFORE INSERT OR UPDATE ON company_roles FOR EACH ROW EXECUTE FUNCTION app_same_org('created_by:member');
--> statement-breakpoint
CREATE TRIGGER memberships_same_org_roles BEFORE INSERT OR UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION app_same_org('company_role_id:company_roles', 'job_title_id:job_titles');
--> statement-breakpoint
-- A role's base and company never change (people holding it would silently gain or lose access).
CREATE FUNCTION company_roles_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.base_role <> OLD.base_role OR NEW.organization_id <> OLD.organization_id THEN
      RAISE EXCEPTION 'A role''s starting point cannot change. Make a new role instead.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL
       AND EXISTS (SELECT 1 FROM memberships m WHERE m.company_role_id = OLD.id AND m.active) THEN
      RAISE EXCEPTION 'People still have this role. Give them another role first.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER company_roles_guard BEFORE UPDATE ON company_roles FOR EACH ROW EXECUTE FUNCTION company_roles_guard();
--> statement-breakpoint
-- The membership's role is always its company role's base role. Named to run before
-- memberships_guard (triggers fire in name order), so the last-Admin check sees the final role.
CREATE FUNCTION memberships_apply_role() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    r record;
  BEGIN
    IF NEW.company_role_id IS NOT NULL THEN
      SELECT base_role, archived_at, organization_id INTO r FROM company_roles WHERE id = NEW.company_role_id;
      IF r.organization_id IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION 'That role belongs to another company' USING ERRCODE = 'check_violation';
      END IF;
      IF r.archived_at IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.company_role_id IS DISTINCT FROM OLD.company_role_id) THEN
        RAISE EXCEPTION 'That role is archived' USING ERRCODE = 'check_violation';
      END IF;
      NEW.role := r.base_role;
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION memberships_apply_role() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER memberships_apply_role BEFORE INSERT OR UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION memberships_apply_role();
--> statement-breakpoint
-- Every company keeps at least one active Admin with the full built-in role (a company-made role
-- can't give permissions back, so someone must hold them all).
CREATE OR REPLACE FUNCTION memberships_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Memberships are deactivated, not deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.organization_id <> OLD.organization_id OR NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'A membership cannot move to another person or company' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.role = 'ADMIN' AND OLD.company_role_id IS NULL AND OLD.active
       AND NOT (NEW.role = 'ADMIN' AND NEW.company_role_id IS NULL AND NEW.active)
       AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = OLD.organization_id AND m.id <> OLD.id
                       AND m.role = 'ADMIN' AND m.company_role_id IS NULL AND m.active) THEN
      RAISE EXCEPTION 'A company needs at least one active Admin with full access' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE OR REPLACE VIEW org_members WITH (security_invoker = true) AS
  SELECT u.id, u.name, u.email, u.phone, m.role, (m.active AND u.active) AS active, m.weekly_capacity_hours, u.created_at,
         m.company_role_id, m.job_title_id
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.organization_id = app_org_id();
--> statement-breakpoint
-- Two people for money: unless the company allows it (small teams), nobody approves a payout to
-- themselves, or records a payment or adjustment on their own payout.
CREATE FUNCTION app_self_money_allowed(org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT coalesce((SELECT allow_self_approval FROM organizations WHERE id = org), false) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_self_money_allowed(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_self_money_allowed(uuid) TO agod_app;
--> statement-breakpoint
CREATE FUNCTION payout_not_self_approved() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.approved_by = NEW.member_id AND NOT app_self_money_allowed(NEW.organization_id) THEN
      RAISE EXCEPTION 'You are paid on this project, so someone else must approve it' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER payout_ledger_entries_not_self BEFORE INSERT ON payout_ledger_entries FOR EACH ROW EXECUTE FUNCTION payout_not_self_approved();
--> statement-breakpoint
CREATE FUNCTION payout_change_not_self() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    payee uuid;
    who uuid;
  BEGIN
    SELECT member_id INTO payee FROM payout_ledger_entries WHERE id = NEW.ledger_entry_id;
    IF TG_TABLE_NAME = 'payment_transactions' THEN
      who := NEW.recorded_by;
    ELSE
      who := NEW.created_by;
    END IF;
    IF who = payee AND NOT app_self_money_allowed(NEW.organization_id) THEN
      RAISE EXCEPTION 'This is your own payout, so someone else must record it' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION payout_change_not_self() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER payment_transactions_not_self BEFORE INSERT ON payment_transactions FOR EACH ROW EXECUTE FUNCTION payout_change_not_self();
--> statement-breakpoint
CREATE TRIGGER adjustments_not_self BEFORE INSERT ON adjustments FOR EACH ROW EXECUTE FUNCTION payout_change_not_self();
--> statement-breakpoint
-- Companies that already exist keep working as before until an Admin turns this off.
UPDATE organizations SET allow_self_approval = true;
