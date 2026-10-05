-- Payments and adjustments (design doc 2.3, 6.2, 13). Mirrors src/modules/payments/balance.ts.

-- Effective amount owed, total paid, and whether the entry is voided.
CREATE FUNCTION ledger_balance(entry_id uuid)
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
    WHERE l.id = entry_id
  $$;
--> statement-breakpoint
CREATE FUNCTION ledger_derived_status(entry_id uuid) RETURNS payout_status
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT CASE
      WHEN b.voided THEN 'VOIDED'::payout_status
      WHEN b.effective_owed - b.paid <= 0 THEN 'PAID'::payout_status
      WHEN b.paid > 0 THEN 'PARTIALLY_PAID'::payout_status
      ELSE 'OWED'::payout_status
    END
    FROM ledger_balance(entry_id) b
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ledger_balance(uuid), ledger_derived_status(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ledger_balance(uuid), ledger_derived_status(uuid) TO agod_app;
--> statement-breakpoint

-- Payments: lock the entry (serialises concurrent payments), then refuse voided entries,
-- currency mismatches and anything above the outstanding balance.
CREATE FUNCTION payments_before_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    entry payout_ledger_entries%ROWTYPE;
    b record;
  BEGIN
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
CREATE TRIGGER payments_before_insert BEFORE INSERT ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION payments_before_insert();
--> statement-breakpoint

-- Adjustments: decreases and write-offs cannot go below what was already paid; a void is only
-- possible before any payment; increases must be positive.
CREATE FUNCTION adjustments_before_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    b record;
  BEGIN
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
--> statement-breakpoint
CREATE TRIGGER adjustments_before_insert BEFORE INSERT ON adjustments
  FOR EACH ROW EXECUTE FUNCTION adjustments_before_insert();
--> statement-breakpoint

-- Keep the stored status equal to the derived one after every payment or adjustment.
CREATE FUNCTION ledger_refresh_status() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  BEGIN
    UPDATE payout_ledger_entries
      SET status = ledger_derived_status(NEW.ledger_entry_id), updated_at = now()
      WHERE id = NEW.ledger_entry_id;
    RETURN NULL;
  END $$;
--> statement-breakpoint
CREATE TRIGGER payments_refresh_status AFTER INSERT ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_refresh_status();
--> statement-breakpoint
CREATE TRIGGER adjustments_refresh_status AFTER INSERT ON adjustments
  FOR EACH ROW EXECUTE FUNCTION ledger_refresh_status();
--> statement-breakpoint

-- Ledger guard, extended: the payment-derived statuses cannot be typed in, and voided entries
-- stay voided.
CREATE OR REPLACE FUNCTION ledger_entries_guard() RETURNS trigger
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
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'VOIDED' THEN
        RAISE EXCEPTION 'A voided payout cannot be restored' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.status IN ('OWED', 'PARTIALLY_PAID', 'PAID') AND NEW.status <> ledger_derived_status(NEW.id) THEN
        RAISE EXCEPTION 'Payout status is derived from payments and adjustments' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
