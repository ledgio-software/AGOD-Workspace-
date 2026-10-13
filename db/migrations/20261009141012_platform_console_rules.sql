-- Rules for Phase 40 (AGOD back office). The audit log is server-only like the community tables;
-- and a company's suspension can only be set or lifted by the back office (the owner connection),
-- never by the company's own Admins through the app role.

REVOKE ALL ON platform_audit FROM agod_app;
--> statement-breakpoint
ALTER TABLE platform_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION organizations_suspension_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF current_user = 'agod_app' AND (NEW.suspended_at IS DISTINCT FROM OLD.suspended_at OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason) THEN
      RAISE EXCEPTION 'Only the AGOD back office can suspend or restore a company' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
--> statement-breakpoint
CREATE TRIGGER organizations_suspension_guard BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION organizations_suspension_guard();
