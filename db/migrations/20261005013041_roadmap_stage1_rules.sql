-- Rules for Phase 6 (roadmap Stage 1 gaps): payout questions, period close and health override.
-- Mirrors src/modules/{questions,periods,projects}. RLS conventions as in *_row_level_security.sql.

GRANT SELECT, INSERT, UPDATE ON payout_questions, payout_periods TO agod_app;
--> statement-breakpoint
ALTER TABLE payout_questions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payout_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Payout questions: a member raises them only on their own payout; managers see and review all.
CREATE POLICY payout_questions_select ON payout_questions FOR SELECT TO agod_app
  USING (app_is_manager() OR (raised_by = app_user_id() AND app_user_role() IS NOT NULL));
--> statement-breakpoint
CREATE POLICY payout_questions_insert ON payout_questions FOR INSERT TO agod_app
  WITH CHECK (
    raised_by = app_user_id() AND app_user_role() IS NOT NULL AND status = 'OPEN'
    AND EXISTS (SELECT 1 FROM payout_ledger_entries l
                WHERE l.id = ledger_entry_id AND l.member_id = app_user_id() AND l.project_id = payout_questions.project_id)
  );
--> statement-breakpoint
CREATE POLICY payout_questions_update ON payout_questions FOR UPDATE TO agod_app
  USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint

-- The question itself never changes; a resolved question is final; only an Admin finishes a
-- question waiting on an Admin or links an adjustment, which must belong to the same payout.
CREATE FUNCTION payout_questions_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'payout_questions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (NEW.ledger_entry_id, NEW.project_id, NEW.raised_by, NEW.question, NEW.created_at)
       IS DISTINCT FROM (OLD.ledger_entry_id, OLD.project_id, OLD.raised_by, OLD.question, OLD.created_at) THEN
      RAISE EXCEPTION 'A payout question cannot be edited' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status = 'RESOLVED' THEN
      RAISE EXCEPTION 'This question is already resolved' USING ERRCODE = 'check_violation';
    END IF;
    IF current_user = 'agod_app' AND NOT app_is_admin() THEN
      IF OLD.status = 'AWAITING_ADMIN' THEN
        RAISE EXCEPTION 'Only an Admin can resolve a question waiting on an Admin' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.adjustment_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only an Admin can record an adjustment' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NEW.adjustment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM adjustments a WHERE a.id = NEW.adjustment_id AND a.ledger_entry_id = NEW.ledger_entry_id
    ) THEN
      RAISE EXCEPTION 'The adjustment belongs to a different payout' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER payout_questions_guard BEFORE UPDATE OR DELETE ON payout_questions
  FOR EACH ROW EXECUTE FUNCTION payout_questions_guard();
--> statement-breakpoint

-- Periods: managers can see which months are closed; only Admins close or reopen them.
CREATE POLICY payout_periods_select ON payout_periods FOR SELECT TO agod_app USING (app_is_manager());
--> statement-breakpoint
CREATE POLICY payout_periods_insert ON payout_periods FOR INSERT TO agod_app WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY payout_periods_update ON payout_periods FOR UPDATE TO agod_app USING (app_is_admin()) WITH CHECK (app_is_admin());
--> statement-breakpoint

-- Months are calendar months in AGOD's operating timezone (decision 6: Africa/Accra).
CREATE FUNCTION app_period_of(ts timestamptz) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT to_char(ts AT TIME ZONE 'Africa/Accra', 'YYYY-MM') $$;
--> statement-breakpoint
CREATE FUNCTION app_period_locked(ts timestamptz) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM payout_periods p WHERE p.period = app_period_of(ts) AND p.locked) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_period_locked(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_period_of(timestamptz), app_period_locked(timestamptz) TO agod_app;
--> statement-breakpoint

-- Only finished months can be closed; reopening needs a reason; the month itself never changes.
-- Closing clears the last reopening, so every reopening carries its own reason (the full
-- history is in the audit log).
CREATE FUNCTION payout_periods_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'payout_periods cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.period IS DISTINCT FROM OLD.period THEN
      RAISE EXCEPTION 'A period cannot be renamed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.locked AND (TG_OP = 'INSERT' OR NOT OLD.locked) THEN
      IF NEW.period >= app_period_of(now()) THEN
        RAISE EXCEPTION 'Only a finished month can be closed' USING ERRCODE = 'check_violation';
      END IF;
      NEW.unlocked_by := NULL;
      NEW.unlocked_at := NULL;
      NEW.unlock_reason := NULL;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.locked AND NOT NEW.locked
       AND (NEW.unlocked_by IS NULL OR length(trim(coalesce(NEW.unlock_reason, ''))) < 3) THEN
      RAISE EXCEPTION 'Reopening a closed month needs a reason' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER payout_periods_guard BEFORE INSERT OR UPDATE OR DELETE ON payout_periods
  FOR EACH ROW EXECUTE FUNCTION payout_periods_guard();
--> statement-breakpoint

-- Payments dated in a closed month are refused (the rest as in *_payment_rules.sql).
CREATE OR REPLACE FUNCTION payments_before_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    entry payout_ledger_entries%ROWTYPE;
    b record;
  BEGIN
    IF app_period_locked(NEW.paid_at) THEN
      RAISE EXCEPTION 'The month % is closed; an Admin must reopen it to record this payment', app_period_of(NEW.paid_at)
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO entry FROM payout_ledger_entries WHERE id = NEW.ledger_entry_id FOR UPDATE;
    SELECT * INTO b FROM ledger_balance(NEW.ledger_entry_id);
    IF b.voided THEN
      RAISE EXCEPTION 'This payout is voided and cannot receive payments' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.currency <> entry.currency THEN
      RAISE EXCEPTION 'Payment currency must match the payout currency' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.amount_minor > b.effective_owed - b.paid THEN
      RAISE EXCEPTION 'Payment exceeds the outstanding balance' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint

-- Adjustments are dated when made, so they are refused while the current month is closed.
CREATE OR REPLACE FUNCTION adjustments_before_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    b record;
  BEGIN
    IF app_period_locked(NEW.created_at) THEN
      RAISE EXCEPTION 'The month % is closed; an Admin must reopen it to record this adjustment', app_period_of(NEW.created_at)
        USING ERRCODE = 'check_violation';
    END IF;
    PERFORM 1 FROM payout_ledger_entries WHERE id = NEW.ledger_entry_id FOR UPDATE;
    SELECT * INTO b FROM ledger_balance(NEW.ledger_entry_id);
    IF b.voided THEN
      RAISE EXCEPTION 'This payout is voided and cannot be adjusted' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.type IN ('DECREASE', 'WRITE_OFF') AND (NEW.amount_minor <= 0 OR NEW.amount_minor > b.effective_owed - b.paid) THEN
      RAISE EXCEPTION 'The adjustment must be more than zero and at most the outstanding balance' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.type = 'INCREASE' AND NEW.amount_minor <= 0 THEN
      RAISE EXCEPTION 'An increase must be more than zero' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.type = 'VOID' AND b.paid > 0 THEN
      RAISE EXCEPTION 'A payout with payments cannot be voided; write off the remainder instead' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;
