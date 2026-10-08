-- Rules for Phase 32 (release approvals / change control). People who can see a project can record
-- its releases; the database keeps the order of steps and the maker-checker rules: whoever wrote a
-- release doesn't approve it, security-review it or deploy it (unless the company allows one person
-- to do it all, as for payouts), and a high-impact release needs a security review first.

GRANT SELECT, INSERT, UPDATE ON releases TO agod_app;
--> statement-breakpoint
ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY releases_tenant ON releases AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY releases_select ON releases FOR SELECT TO agod_app USING (app_can_view_project(project_id));
--> statement-breakpoint
CREATE POLICY releases_insert ON releases FOR INSERT TO agod_app
  WITH CHECK (app_can_view_project(project_id) AND created_by = app_user_id() AND status = 'DRAFT');
--> statement-breakpoint
CREATE POLICY releases_update ON releases FOR UPDATE TO agod_app
  USING (app_can_view_project(project_id)) WITH CHECK (app_can_view_project(project_id));
--> statement-breakpoint
CREATE TRIGGER releases_same_org BEFORE INSERT OR UPDATE ON releases FOR EACH ROW
  EXECUTE FUNCTION app_same_org('project_id:projects', 'created_by:member', 'submitted_by:member', 'security_reviewed_by:member',
    'decided_by:member', 'deployed_by:member', 'rolled_back_by:member');
--> statement-breakpoint
CREATE FUNCTION releases_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    one_person boolean := app_self_money_allowed(NEW.organization_id);
    authors uuid[] := ARRAY[OLD.created_by, OLD.submitted_by];
    ok boolean;
  BEGIN
    IF NEW.project_id <> OLD.project_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'A release stays with its project and author' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- What the release is can change only while it's a draft.
    IF OLD.status <> 'DRAFT' AND (NEW.title, NEW.version_label, NEW.change_summary, NEW.reason, NEW.security_impact, NEW.test_evidence, NEW.rollback_plan, NEW.emergency)
       IS DISTINCT FROM (OLD.title, OLD.version_label, OLD.change_summary, OLD.reason, OLD.security_impact, OLD.test_evidence, OLD.rollback_plan, OLD.emergency) THEN
      RAISE EXCEPTION 'A submitted release can''t be edited. Reject it and record a new one.' USING ERRCODE = 'check_violation';
    END IF;
    -- Steps happen in order.
    IF NEW.status <> OLD.status THEN
      ok := (OLD.status, NEW.status) IN (('DRAFT', 'SUBMITTED'), ('SUBMITTED', 'DRAFT'), ('SUBMITTED', 'APPROVED'), ('SUBMITTED', 'REJECTED'),
                                         ('APPROVED', 'DEPLOYED'), ('DEPLOYED', 'ROLLED_BACK'))
            OR (OLD.status = 'SUBMITTED' AND NEW.status = 'DEPLOYED' AND OLD.emergency);
      -- Taking a release back to draft would make its security check stale.
      IF OLD.status = 'SUBMITTED' AND NEW.status = 'DRAFT' AND OLD.security_reviewed_by IS NOT NULL THEN
        ok := false;
      END IF;
      IF NOT ok THEN
        RAISE EXCEPTION 'A release can''t go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- Decisions, reviews and deployments are recorded once.
    IF (OLD.decided_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM OLD.decided_by)
       OR (OLD.security_reviewed_by IS NOT NULL AND NEW.security_reviewed_by IS DISTINCT FROM OLD.security_reviewed_by)
       OR (OLD.deployed_by IS NOT NULL AND NEW.deployed_by IS DISTINCT FROM OLD.deployed_by) THEN
      RAISE EXCEPTION 'That step is already recorded' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.security_reviewed_by IS NOT NULL AND OLD.security_reviewed_by IS NULL THEN
      IF NOT one_person AND NEW.security_reviewed_by = ANY (authors) THEN
        RAISE EXCEPTION 'Someone other than the author must do the security check' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NEW.decided_by IS NOT NULL AND OLD.decided_by IS NULL THEN
      IF NOT app_is_manager() THEN
        RAISE EXCEPTION 'Only managers approve releases' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT one_person AND NEW.decided_by = ANY (authors) THEN
        RAISE EXCEPTION 'You wrote this release, so someone else must approve it' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.decision = 'APPROVED' AND OLD.security_impact = 'HIGH' AND NEW.security_reviewed_by IS NULL THEN
        RAISE EXCEPTION 'A high-impact release needs a security check before approval' USING ERRCODE = 'check_violation';
      END IF;
      -- Decided while submitted, or afterwards for an emergency release that was already deployed.
      IF NOT (OLD.status = 'SUBMITTED' OR (OLD.status = 'DEPLOYED' AND OLD.emergency)) THEN
        RAISE EXCEPTION 'This release can''t be decided now' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.deployed_by IS NOT NULL AND OLD.deployed_by IS NULL THEN
      IF NOT one_person AND NEW.deployed_by = OLD.created_by THEN
        RAISE EXCEPTION 'You wrote this release, so someone else must deploy it' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER releases_guard BEFORE UPDATE ON releases FOR EACH ROW EXECUTE FUNCTION releases_guard();
