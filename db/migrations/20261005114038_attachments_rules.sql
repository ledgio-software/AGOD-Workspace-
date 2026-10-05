-- Rules for Phase 9 (file attachments). Mirrors src/modules/attachments.

GRANT SELECT, INSERT, UPDATE ON attachments TO agod_app;
--> statement-breakpoint
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Project documents and task files are visible with the project. Payment receipts are visible to
-- managers and to the person who was paid (like the payment itself).
CREATE POLICY attachments_select ON attachments FOR SELECT TO agod_app
  USING (
    CASE kind
      WHEN 'PAYMENT' THEN app_is_manager() OR EXISTS (
        SELECT 1 FROM payment_transactions p JOIN payout_ledger_entries l ON l.id = p.ledger_entry_id
        WHERE p.id = payment_id AND l.member_id = app_user_id() AND app_user_role() IS NOT NULL)
      ELSE app_can_view_project(project_id)
    END
  );
--> statement-breakpoint
-- Uploads, as oneself: managers add project documents; managers and the assignee add task files;
-- only Admins (who record payments) add receipts.
CREATE POLICY attachments_insert ON attachments FOR INSERT TO agod_app
  WITH CHECK (
    uploaded_by = app_user_id() AND app_user_role() IS NOT NULL AND removed_at IS NULL
    AND CASE kind
      WHEN 'PROJECT' THEN app_is_manager()
      WHEN 'TASK' THEN app_is_manager() OR EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.assigned_to = app_user_id())
      WHEN 'PAYMENT' THEN app_is_admin()
    END
  );
--> statement-breakpoint
-- Removing (soft) a file: the uploader or a manager.
CREATE POLICY attachments_update ON attachments FOR UPDATE TO agod_app
  USING (app_is_manager() OR uploaded_by = app_user_id())
  WITH CHECK (app_is_manager() OR uploaded_by = app_user_id());
--> statement-breakpoint

-- The target must belong to the project; afterwards only the removal fields may change, once,
-- and payment receipts are never removed (financial evidence).
CREATE FUNCTION attachments_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'attachments cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.kind = 'TASK' AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = NEW.task_id AND t.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'That task is not part of this project' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.kind = 'PAYMENT' AND NOT EXISTS (
        SELECT 1 FROM payment_transactions p JOIN payout_ledger_entries l ON l.id = p.ledger_entry_id
        WHERE p.id = NEW.payment_id AND l.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'That payment is not part of this project' USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.id, NEW.kind, NEW.project_id, NEW.task_id, NEW.payment_id, NEW.file_name, NEW.content_type, NEW.size_bytes, NEW.storage_key, NEW.uploaded_by, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.kind, OLD.project_id, OLD.task_id, OLD.payment_id, OLD.file_name, OLD.content_type, OLD.size_bytes, OLD.storage_key, OLD.uploaded_by, OLD.created_at) THEN
      RAISE EXCEPTION 'An attachment cannot be edited' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'This file was already removed' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.kind = 'PAYMENT' THEN
      RAISE EXCEPTION 'Payment receipts cannot be removed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF current_user = 'agod_app' AND NEW.removed_by IS DISTINCT FROM app_user_id() THEN
      RAISE EXCEPTION 'Remove files as yourself' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER attachments_guard BEFORE INSERT OR UPDATE OR DELETE ON attachments
  FOR EACH ROW EXECUTE FUNCTION attachments_guard();
