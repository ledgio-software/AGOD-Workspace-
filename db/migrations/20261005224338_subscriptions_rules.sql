-- Rules for Phase 17 (services and subscriptions). PMs and Admins only. Nothing is deleted:
-- services are deactivated, subscriptions ended or cancelled, and amendments are append-only.

GRANT SELECT, INSERT, UPDATE ON services, subscriptions TO agod_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON subscription_amendments TO agod_app;
--> statement-breakpoint
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE subscription_amendments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY services_select ON services FOR SELECT TO agod_app USING (app_is_manager());
--> statement-breakpoint
CREATE POLICY services_insert ON services FOR INSERT TO agod_app WITH CHECK (app_is_manager() AND created_by = app_user_id());
--> statement-breakpoint
CREATE POLICY services_update ON services FOR UPDATE TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY subscriptions_select ON subscriptions FOR SELECT TO agod_app USING (app_is_manager());
--> statement-breakpoint
CREATE POLICY subscriptions_insert ON subscriptions FOR INSERT TO agod_app WITH CHECK (app_is_manager() AND created_by = app_user_id());
--> statement-breakpoint
CREATE POLICY subscriptions_update ON subscriptions FOR UPDATE TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY subscription_amendments_select ON subscription_amendments FOR SELECT TO agod_app USING (app_is_manager());
--> statement-breakpoint
CREATE POLICY subscription_amendments_insert ON subscription_amendments FOR INSERT TO agod_app
  WITH CHECK (app_is_manager() AND created_by = app_user_id());
--> statement-breakpoint
CREATE FUNCTION subscriptions_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION '% cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_TABLE_NAME = 'subscription_amendments' THEN
      RAISE EXCEPTION 'Subscription amendments cannot be changed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Nested IFs: plpgsql would resolve both tables' columns in a combined condition.
    IF TG_TABLE_NAME = 'services' THEN
      IF (NEW.id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'A service''s identity cannot be changed' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSE
      IF (NEW.id, NEW.customer_id, NEW.service_id, NEW.service_name, NEW.created_by, NEW.created_at)
         IS DISTINCT FROM (OLD.id, OLD.customer_id, OLD.service_id, OLD.service_name, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'A subscription''s customer and service cannot be changed' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF OLD.status IN ('ENDED', 'CANCELLED') THEN
        RAISE EXCEPTION 'An ended or cancelled subscription cannot be changed' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER services_guard BEFORE UPDATE OR DELETE ON services FOR EACH ROW EXECUTE FUNCTION subscriptions_guard();
--> statement-breakpoint
CREATE TRIGGER subscriptions_guard BEFORE UPDATE OR DELETE ON subscriptions FOR EACH ROW EXECUTE FUNCTION subscriptions_guard();
--> statement-breakpoint
CREATE TRIGGER subscription_amendments_guard BEFORE UPDATE OR DELETE ON subscription_amendments FOR EACH ROW EXECUTE FUNCTION subscriptions_guard();
--> statement-breakpoint
-- PMs read the history of services and subscriptions too (no project on these events).
DROP POLICY audit_select ON audit_events;
--> statement-breakpoint
CREATE POLICY audit_select ON audit_events FOR SELECT TO agod_app
  USING (app_is_admin()
    OR (app_is_manager() AND project_id IS NOT NULL AND app_can_view_project(project_id))
    OR (app_is_manager() AND project_id IS NULL AND entity_type IN ('customer', 'customer_contact', 'service', 'subscription'))
    OR (actor_id = app_user_id() AND app_user_role() IS NOT NULL));
