-- Rules for Phase 41 (trust & safety). Risk flags are server-only like the other community tables:
-- the app role has no access; src/modules/safety writes them after its own checks.

REVOKE ALL ON risk_flags FROM agod_app;
--> statement-breakpoint
ALTER TABLE risk_flags ENABLE ROW LEVEL SECURITY;
