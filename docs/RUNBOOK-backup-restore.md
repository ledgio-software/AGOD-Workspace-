# Backup and restore runbook

Payout history is financial record. Before real payouts are entered, the team must have done the
**restore exercise** at the end of this page at least once (design doc, Phase 4 and Phase 5 exit).

## What protects the data

| Layer | What it covers | Where |
|---|---|---|
| Neon point-in-time restore | Any moment within the project's restore window (continuous WAL history) | Neon → Settings → Storage / "History retention" (check the window on your plan; the free plan is short, paid plans keep days) |
| Monthly logical backup (`pg_dump`) | A copy outside Neon, for the case where the Neon project itself is lost | Taken by an Admin, stored encrypted off-Neon (see below) |
| Append-only design | Payments, adjustments, snapshots and audit events cannot be edited or deleted by the app | Database triggers (`docs/PERMISSIONS.md`) |

Set the history retention to the longest the plan allows, and at least 7 days once real payouts start.

## Restore from point in time (most likely case)

Use when data was damaged or deleted by mistake, e.g. a bad migration.

1. **Stop changes.** Tell the team not to use the app. Note the time *before* the problem (UTC).
2. In Neon, open the project → **Branches → New branch**.
   - Parent: `production`
   - **Include data up to: specific point in time**: the time from step 1
   - Name: `restore-YYYYMMDD-HHMM`
3. Copy that branch's **direct** connection string. On your machine:
   ```bash
   psql "<restore branch direct string>" -f scripts/verify-restore.sql
   ```
   Check the numbers make sense (projects, ledger totals, latest audit event before the problem).
4. Decide:
   - **Small damage:** copy the specific rows back to `production` with SQL (pair with a second Admin).
   - **Large damage:** promote the restore: in Neon, open the restore branch → **Set as default**, then
     put its **pooled** string into Vercel's Production `DATABASE_URL` and its **direct** string into the
     GitHub `production` environment's `DATABASE_URL_DIRECT`, then redeploy Production.
5. Record what happened, the restore point and who did it, as a note in the project's issue tracker.

## Monthly off-Neon backup

An Admin, on a trusted machine with PostgreSQL 16+ client tools:

```bash
pg_dump --format=custom --no-owner --no-privileges \
  --file="agod-$(date +%Y-%m-%d).dump" "<production direct string>"
gpg --symmetric --cipher-algo AES256 "agod-$(date +%Y-%m-%d).dump"   # passphrase in the team password manager
rm "agod-$(date +%Y-%m-%d).dump"
```

Store the `.gpg` file in the agreed private location (not the Git repository, not chat). Keep 12 months.

Restore it into an **empty** Neon branch or local database:

```bash
gpg --decrypt agod-YYYY-MM-DD.dump.gpg > agod.dump
pg_restore --no-owner --no-privileges --dbname="<empty target direct string>" agod.dump
psql "<empty target direct string>" -c "CREATE ROLE agod_app NOLOGIN NOBYPASSRLS" -c "GRANT agod_app TO CURRENT_USER"
psql "<empty target direct string>" -f scripts/verify-restore.sql
```

(`--no-privileges` skips grants; re-running `npm run db:migrate` on the target is a no-op for tables
but the `agod_app` role and its grants must exist, as above, before the app can use it. If anything is
missing, compare `\dp` output with the original.)

## Restore exercise (do this before real payouts, then every quarter)

1. Note the current time. On staging, record a test payment so there is a fresh change.
2. Run `scripts/verify-restore.sql` against **staging** and save the output.
3. Create a point-in-time branch of **staging** at the noted time, as in "Restore from point in time".
4. Run the script against the restore branch. Every line must match step 2, except that the fresh
   payment from step 1 must be **missing** (it happened after the restore point).
5. Point a local copy of the app at the restore branch (`DATABASE_URL` in `.env.local`), sign in, and
   check the ledger and one project page.
6. Delete the restore branch. Write down the date, who did it and the result in `docs/SETUP.md`
   under "Restore exercises".
