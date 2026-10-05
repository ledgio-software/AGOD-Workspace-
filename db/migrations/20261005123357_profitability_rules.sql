-- Rules for Phase 10 (Stage 3, profitability). Costs are financial records: managers read and
-- add them; nothing is edited or deleted, a wrong entry is voided once, with a reason.

GRANT SELECT, INSERT, UPDATE ON project_costs TO agod_app;
--> statement-breakpoint
ALTER TABLE project_costs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_costs_select ON project_costs FOR SELECT TO agod_app USING (app_is_manager());
--> statement-breakpoint
CREATE POLICY project_costs_insert ON project_costs FOR INSERT TO agod_app
  WITH CHECK (app_is_manager() AND created_by = app_user_id() AND voided_at IS NULL);
--> statement-breakpoint
CREATE POLICY project_costs_update ON project_costs FOR UPDATE TO agod_app
  USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE FUNCTION project_costs_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'project_costs cannot be deleted; void the entry instead' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (NEW.id, NEW.project_id, NEW.category, NEW.description, NEW.vendor, NEW.amount_minor, NEW.currency, NEW.incurred_on, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.project_id, OLD.category, OLD.description, OLD.vendor, OLD.amount_minor, OLD.currency, OLD.incurred_on, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'A cost cannot be edited; void it and record a new one' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'This cost is already voided' USING ERRCODE = 'check_violation';
    END IF;
    IF current_user = 'agod_app' AND NEW.voided_by IS DISTINCT FROM app_user_id() THEN
      RAISE EXCEPTION 'Void costs as yourself' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER project_costs_guard BEFORE UPDATE OR DELETE ON project_costs
  FOR EACH ROW EXECUTE FUNCTION project_costs_guard();
--> statement-breakpoint
-- Starting categories for existing projects, from their names (editable afterwards).
UPDATE projects SET category = 'WEBSITE' WHERE category = 'OTHER' AND name ~* 'website|web site|landing';
--> statement-breakpoint
UPDATE projects SET category = 'MOBILE_APP' WHERE category = 'OTHER' AND name ~* 'mobile app|android|ios';
