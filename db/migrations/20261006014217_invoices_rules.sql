-- Rules for Phase 20 (invoices). PMs and Admins prepare, issue and send invoices; only Admins record
-- or void customer payments and edit the invoice settings. Issued invoices are frozen except for
-- payments, sending and voiding; voided ones can't change at all.

GRANT SELECT, INSERT, UPDATE, DELETE ON invoices, invoice_lines TO agod_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON invoice_payments, invoice_settings TO agod_app;
--> statement-breakpoint
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoice_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoices_select ON invoices FOR SELECT TO agod_app USING (app_is_manager());
--> statement-breakpoint
CREATE POLICY invoices_insert ON invoices FOR INSERT TO agod_app WITH CHECK (app_is_manager() AND created_by = app_user_id());
--> statement-breakpoint
CREATE POLICY invoices_update ON invoices FOR UPDATE TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY invoices_delete ON invoices FOR DELETE TO agod_app USING (app_is_manager() AND status = 'DRAFT');
--> statement-breakpoint
CREATE POLICY invoice_lines_all ON invoice_lines FOR ALL TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY invoice_payments_select ON invoice_payments FOR SELECT TO agod_app USING (app_is_manager());
--> statement-breakpoint
CREATE POLICY invoice_payments_insert ON invoice_payments FOR INSERT TO agod_app WITH CHECK (app_is_admin() AND recorded_by = app_user_id());
--> statement-breakpoint
CREATE POLICY invoice_payments_update ON invoice_payments FOR UPDATE TO agod_app USING (app_is_admin()) WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY invoice_settings_select ON invoice_settings FOR SELECT TO agod_app USING (app_is_manager());
--> statement-breakpoint
CREATE POLICY invoice_settings_insert ON invoice_settings FOR INSERT TO agod_app WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY invoice_settings_update ON invoice_settings FOR UPDATE TO agod_app USING (app_is_admin()) WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE FUNCTION invoices_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Issued invoices cannot be deleted; void them instead' USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN OLD;
    END IF;
    IF (NEW.id, NEW.customer_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.customer_id, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'An invoice''s customer cannot be changed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status = 'VOID' THEN
      RAISE EXCEPTION 'A void invoice cannot be changed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT (NEW.status = OLD.status OR (OLD.status = 'DRAFT' AND NEW.status = 'ISSUED') OR (OLD.status = 'ISSUED' AND NEW.status = 'VOID')) THEN
      RAISE EXCEPTION 'An invoice cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'ISSUED' AND (NEW.number, NEW.issue_date, NEW.due_date, NEW.currency, NEW.total_minor, NEW.bill_to_name, NEW.bill_to_email, NEW.notes, NEW.issued_by, NEW.issued_at)
       IS DISTINCT FROM (OLD.number, OLD.issue_date, OLD.due_date, OLD.currency, OLD.total_minor, OLD.bill_to_name, OLD.bill_to_email, OLD.notes, OLD.issued_by, OLD.issued_at) THEN
      RAISE EXCEPTION 'An issued invoice cannot be edited; void it and issue a new one' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'VOID' AND NEW.paid_minor > 0 THEN
      RAISE EXCEPTION 'Void the invoice''s payments before voiding the invoice' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_guard();
--> statement-breakpoint
CREATE FUNCTION invoice_lines_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    parent_status invoice_status;
  BEGIN
    SELECT status INTO parent_status FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    IF parent_status = 'DRAFT' THEN
      IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
        RAISE EXCEPTION 'A line cannot move to another invoice' USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN COALESCE(NEW, OLD);
    END IF;
    -- After voiding, lines are only marked voided so what they billed can be billed again.
    IF TG_OP = 'UPDATE' AND parent_status = 'VOID' AND NOT OLD.voided AND NEW.voided
       AND (to_jsonb(NEW) - 'voided') = (to_jsonb(OLD) - 'voided') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Lines of an issued invoice cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();
--> statement-breakpoint
CREATE FUNCTION invoice_payments_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Payments cannot be deleted; void them with a reason' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'ISSUED' THEN
        RAISE EXCEPTION 'Payments can only be recorded on issued invoices' USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
       OR (to_jsonb(NEW) - 'voided_at' - 'voided_by' - 'void_reason') <> (to_jsonb(OLD) - 'voided_at' - 'voided_by' - 'void_reason') THEN
      RAISE EXCEPTION 'A payment can only be voided once, with a reason' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_payments_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_payments FOR EACH ROW EXECUTE FUNCTION invoice_payments_guard();
--> statement-breakpoint
INSERT INTO invoice_settings (id) VALUES (1);
--> statement-breakpoint
DROP POLICY audit_select ON audit_events;
--> statement-breakpoint
CREATE POLICY audit_select ON audit_events FOR SELECT TO agod_app
  USING (app_is_admin()
    OR (app_is_manager() AND project_id IS NOT NULL AND app_can_view_project(project_id))
    OR (app_is_manager() AND project_id IS NULL AND entity_type IN ('customer', 'customer_contact', 'service', 'subscription', 'invoice'))
    OR (actor_id = app_user_id() AND app_user_role() IS NOT NULL));
