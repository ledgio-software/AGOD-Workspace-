-- Rules for Phase 42 (trust & safety, part 2). Sign-in signals and appeals are server-only like the
-- other community tables: the app role has no access; src/modules/safety writes them.

REVOKE ALL ON login_signals, appeals FROM agod_app;
--> statement-breakpoint
ALTER TABLE login_signals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE appeals ENABLE ROW LEVEL SECURITY;
