-- Approval flow rules enforced by the database (design doc sections 5.2-5.3).

-- Members may request approval for projects they belong to, but have no UPDATE on projects.
-- This function performs exactly that one status change after checking visibility and state.
CREATE FUNCTION app_request_approval(pid uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    current_status project_status;
  BEGIN
    IF NOT app_can_view_project(pid) THEN
      RAISE EXCEPTION 'Project not found' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT status INTO current_status FROM projects WHERE id = pid FOR UPDATE;
    IF current_status NOT IN ('IN_PROGRESS', 'CHANGES_REQUESTED') THEN
      RAISE EXCEPTION 'Approval can only be requested for a project that is in progress' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE projects SET status = 'PENDING_APPROVAL', version = version + 1, updated_at = now() WHERE id = pid;
  END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_request_approval(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_request_approval(uuid) TO agod_app;
--> statement-breakpoint

-- A project becomes COMPLETED only from PENDING_APPROVAL and only in the same transaction that
-- wrote its compensation snapshot (now() is fixed per transaction). Only Admins reopen.
CREATE FUNCTION projects_status_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' THEN
      IF OLD.status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'A project can only be completed from pending approval' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM compensation_snapshots s WHERE s.project_id = NEW.id AND s.created_at = now()
      ) THEN
        RAISE EXCEPTION 'A project can only be completed by the approval transaction' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF OLD.status = 'COMPLETED' AND NEW.status IS DISTINCT FROM 'COMPLETED'
       AND current_user = 'agod_app' AND NOT app_is_admin() THEN
      RAISE EXCEPTION 'Only an Admin can reopen an approved project' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER projects_status_guard BEFORE UPDATE OF status ON projects
  FOR EACH ROW EXECUTE FUNCTION projects_status_guard();
--> statement-breakpoint

-- Ledger entries: amounts, recipient and approval facts are fixed at creation. Only the status
-- (and notes) change afterwards. Never deleted.
CREATE FUNCTION ledger_entries_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'payout_ledger_entries cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (NEW.project_id, NEW.snapshot_line_id, NEW.member_id, NEW.amount_owed_minor, NEW.currency, NEW.approved_by, NEW.approved_at)
       IS DISTINCT FROM
       (OLD.project_id, OLD.snapshot_line_id, OLD.member_id, OLD.amount_owed_minor, OLD.currency, OLD.approved_by, OLD.approved_at) THEN
      RAISE EXCEPTION 'Ledger amounts are fixed at approval; use an adjustment' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_guard BEFORE UPDATE OR DELETE ON payout_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_guard();
