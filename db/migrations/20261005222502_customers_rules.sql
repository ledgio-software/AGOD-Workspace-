-- Rules for Phase 16 (customers). PMs and Admins manage customers and contacts; Team Members see
-- the client name copied onto their projects but not the customer records. Customers are archived,
-- contacts deactivated: nothing is deleted.

GRANT SELECT, INSERT, UPDATE ON customers, customer_contacts TO agod_app;
--> statement-breakpoint
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customers_select ON customers FOR SELECT TO agod_app USING (app_is_manager());
--> statement-breakpoint
CREATE POLICY customers_insert ON customers FOR INSERT TO agod_app
  WITH CHECK (app_is_manager() AND created_by = app_user_id());
--> statement-breakpoint
CREATE POLICY customers_update ON customers FOR UPDATE TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY customer_contacts_select ON customer_contacts FOR SELECT TO agod_app USING (app_is_manager());
--> statement-breakpoint
CREATE POLICY customer_contacts_insert ON customer_contacts FOR INSERT TO agod_app WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE POLICY customer_contacts_update ON customer_contacts FOR UPDATE TO agod_app USING (app_is_manager()) WITH CHECK (app_is_manager());
--> statement-breakpoint
CREATE FUNCTION customers_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION '% cannot be deleted; archive or deactivate instead', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Nested IFs: plpgsql would resolve both tables' columns in a combined condition.
    IF TG_TABLE_NAME = 'customers' THEN
      IF (NEW.id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'A customer''s identity cannot be changed' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSE
      IF (NEW.id, NEW.customer_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.customer_id, OLD.created_at) THEN
        RAISE EXCEPTION 'A contact cannot move to another customer' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER customers_guard BEFORE UPDATE OR DELETE ON customers FOR EACH ROW EXECUTE FUNCTION customers_guard();
--> statement-breakpoint
CREATE TRIGGER customer_contacts_guard BEFORE UPDATE OR DELETE ON customer_contacts FOR EACH ROW EXECUTE FUNCTION customers_guard();
--> statement-breakpoint
-- Existing external projects: one customer per distinct client name (case and spaces ignored),
-- owned by the owner of that client's first project.
INSERT INTO customers (name, owner_id, created_by, created_at)
SELECT DISTINCT ON (lower(n.name)) n.name, n.project_owner_id, n.created_by, n.created_at
FROM (
  SELECT CASE WHEN length(btrim(coalesce(client_name, ''))) >= 2 THEN btrim(client_name) ELSE 'Unnamed client' END AS name,
         project_owner_id, created_by, created_at
  FROM projects WHERE client_type = 'EXTERNAL'
) n
ORDER BY lower(n.name), n.created_at;
--> statement-breakpoint
UPDATE projects p SET customer_id = c.id, client_name = c.name
FROM customers c
WHERE p.client_type = 'EXTERNAL'
  AND lower(c.name) = lower(CASE WHEN length(btrim(coalesce(p.client_name, ''))) >= 2 THEN btrim(p.client_name) ELSE 'Unnamed client' END);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_matches_client_type" CHECK (("projects"."client_type" = 'EXTERNAL') = ("projects"."customer_id" IS NOT NULL));
--> statement-breakpoint
-- Customer history has no project, so let PMs read customer and contact events too.
DROP POLICY audit_select ON audit_events;
--> statement-breakpoint
CREATE POLICY audit_select ON audit_events FOR SELECT TO agod_app
  USING (app_is_admin()
    OR (app_is_manager() AND project_id IS NOT NULL AND app_can_view_project(project_id))
    OR (app_is_manager() AND project_id IS NULL AND entity_type IN ('customer', 'customer_contact'))
    OR (actor_id = app_user_id() AND app_user_role() IS NOT NULL));
