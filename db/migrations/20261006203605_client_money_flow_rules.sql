-- Rules for Phase 29: the client money flow (payment plans, client sign-off, change requests, and
-- paying the team in step with what the client has paid). Managers only, like invoices.

GRANT SELECT, INSERT, UPDATE ON change_requests TO agod_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON billing_stages TO agod_app;
--> statement-breakpoint
ALTER TABLE change_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE billing_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY change_requests_tenant ON change_requests AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY change_requests_all ON change_requests FOR ALL TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY billing_stages_tenant ON billing_stages AS RESTRICTIVE FOR ALL TO agod_app
  USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY billing_stages_all ON billing_stages FOR ALL TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE TRIGGER change_requests_same_org BEFORE INSERT OR UPDATE ON change_requests FOR EACH ROW
  EXECUTE FUNCTION app_same_org('project_id:projects', 'created_by:member', 'decided_by:member');
--> statement-breakpoint
CREATE TRIGGER billing_stages_same_org BEFORE INSERT OR UPDATE ON billing_stages FOR EACH ROW
  EXECUTE FUNCTION app_same_org('project_id:projects', 'milestone_id:milestones', 'change_request_id:change_requests', 'invoice_line_id:invoice_lines', 'created_by:member', 'signed_off_by:member');
--> statement-breakpoint
-- A change request is edited only as a draft; once decided it never changes.
CREATE FUNCTION change_requests_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.project_id <> OLD.project_id OR NEW.created_by <> OLD.created_by THEN
      RAISE EXCEPTION 'A change request cannot move to another project' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status IN ('APPROVED', 'REJECTED') THEN
      RAISE EXCEPTION 'This change request has been decided and can no longer change' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'SENT' AND (NEW.title <> OLD.title OR NEW.amount_minor <> OLD.amount_minor OR NEW.extra_days <> OLD.extra_days
                                OR NEW.description IS DISTINCT FROM OLD.description) THEN
      RAISE EXCEPTION 'The client has this change request: decide it, or reject it and make a new one' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER change_requests_guard BEFORE UPDATE ON change_requests FOR EACH ROW EXECUTE FUNCTION change_requests_guard();
--> statement-breakpoint
-- A stage on a live invoice keeps its amount; stages that were invoiced or come from a change
-- request are never deleted.
CREATE FUNCTION billing_stages_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    invoiced boolean;
  BEGIN
    invoiced := OLD.invoice_line_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM invoice_lines l WHERE l.id = OLD.invoice_line_id AND NOT l.voided);
    IF TG_OP = 'DELETE' THEN
      IF invoiced OR OLD.kind = 'CHANGE' THEN
        RAISE EXCEPTION 'This payment stage is invoiced or comes from a change request, so it stays' USING ERRCODE = 'check_violation';
      END IF;
      RETURN OLD;
    END IF;
    IF NEW.project_id <> OLD.project_id OR NEW.created_by <> OLD.created_by THEN
      RAISE EXCEPTION 'A payment stage cannot move to another project' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF invoiced AND (NEW.amount_minor <> OLD.amount_minor OR NEW.kind <> OLD.kind) THEN
      RAISE EXCEPTION 'This payment stage is on an invoice: void the invoice to change its amount' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER billing_stages_guard BEFORE UPDATE OR DELETE ON billing_stages FOR EACH ROW EXECUTE FUNCTION billing_stages_guard();
--> statement-breakpoint
-- What the client has paid for a project: each issued invoice's payments shared across its lines
-- in proportion, counting the lines that bill this project.
CREATE FUNCTION app_project_client_paid(pid uuid) RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT coalesce(sum(CASE WHEN i.total_minor > 0 THEN (l.amount_minor * LEAST(i.paid_minor, i.total_minor)) / i.total_minor ELSE 0 END), 0)::bigint
    FROM invoice_lines l
    JOIN invoices i ON i.id = l.invoice_id
    JOIN projects p ON p.id = l.project_id
    WHERE l.project_id = pid AND NOT l.voided AND i.status = 'ISSUED' AND p.organization_id = app_org_id()
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_project_client_paid(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_project_client_paid(uuid) TO agod_app;
--> statement-breakpoint
-- How much of a payout may be paid so far. With "in step with the client" on, a client project's
-- payouts are released in proportion to what the client has paid for it (whole pesewas, rounded
-- down); otherwise (and for internal projects) all of it.
CREATE FUNCTION app_payout_releasable(entry_id uuid) RETURNS bigint
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    e record;
    owed bigint;
    client_paid bigint;
  BEGIN
    SELECT l.organization_id, l.project_id, p.total_value_minor, p.customer_id, p.client_type, o.payout_release
      INTO e
      FROM payout_ledger_entries l
      JOIN projects p ON p.id = l.project_id
      JOIN organizations o ON o.id = l.organization_id
      WHERE l.id = entry_id AND l.organization_id = app_org_id();
    IF NOT FOUND THEN RETURN 0; END IF;
    SELECT effective_owed INTO owed FROM ledger_balance(entry_id);
    IF e.payout_release <> 'ON_CLIENT_PAYMENT' OR e.client_type <> 'EXTERNAL' OR e.customer_id IS NULL OR e.total_value_minor <= 0 THEN
      RETURN owed;
    END IF;
    client_paid := LEAST(app_project_client_paid(e.project_id), e.total_value_minor);
    RETURN (owed * client_paid) / e.total_value_minor;
  END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_payout_releasable(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_payout_releasable(uuid) TO agod_app;
--> statement-breakpoint
CREATE FUNCTION payment_within_release() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    releasable bigint;
    owed bigint;
    already bigint;
  BEGIN
    releasable := app_payout_releasable(NEW.ledger_entry_id);
    SELECT effective_owed INTO owed FROM ledger_balance(NEW.ledger_entry_id);
    -- Fully released: the other payment rules (never more than owed) apply as before.
    IF releasable >= owed THEN RETURN NEW; END IF;
    SELECT coalesce(sum(amount_minor), 0) INTO already FROM payment_transactions WHERE ledger_entry_id = NEW.ledger_entry_id;
    IF already + NEW.amount_minor > releasable THEN
      RAISE EXCEPTION 'Only % of this payout can be paid until the client pays more for the project',
        NEW.currency || ' ' || to_char(greatest(releasable - already, 0) / 100.0, 'FM999,999,999,990.00')
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION payment_within_release() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER payment_transactions_release BEFORE INSERT ON payment_transactions FOR EACH ROW EXECUTE FUNCTION payment_within_release();
