-- Run against a restored database (and against the original) and compare the output line by line.
-- Every figure must match the original at the restore point.
SELECT 'users' AS check, count(*)::text AS value FROM users
UNION ALL SELECT 'projects', count(*)::text FROM projects
UNION ALL SELECT 'completed projects', count(*)::text FROM projects WHERE status = 'COMPLETED'
UNION ALL SELECT 'tasks', count(*)::text FROM tasks
UNION ALL SELECT 'snapshots', count(*)::text FROM compensation_snapshots
UNION ALL SELECT 'snapshot lines total (pesewas)', coalesce(sum(amount_owed_minor), 0)::text FROM compensation_snapshot_lines
UNION ALL SELECT 'ledger entries', count(*)::text FROM payout_ledger_entries
UNION ALL SELECT 'ledger owed, not voided (pesewas)', coalesce(sum(amount_owed_minor), 0)::text FROM payout_ledger_entries WHERE status <> 'VOIDED'
UNION ALL SELECT 'payments', count(*)::text FROM payment_transactions
UNION ALL SELECT 'payments total (pesewas)', coalesce(sum(amount_minor), 0)::text FROM payment_transactions
UNION ALL SELECT 'adjustments', count(*)::text FROM adjustments
UNION ALL SELECT 'audit events', count(*)::text FROM audit_events
UNION ALL SELECT 'latest audit event', coalesce(max(created_at)::text, '-') FROM audit_events
UNION ALL SELECT 'applied migrations', count(*)::text FROM drizzle.__drizzle_migrations;
