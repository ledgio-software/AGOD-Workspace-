# Phase 0 decisions

Baseline decisions for the MVP, taken from the design document
(`Project doc/AGOD Internal Project & Payout Tracker.md`, sections 12 and 15) and confirmed on 2026-10-04.
Changing any of these later needs a PR that updates this file.

| # | Decision | Choice |
|---|---|---|
| 1 | Currency | **GHS only** for the MVP. Money is stored as integer minor units (pesewas) with an ISO currency code column, so other currencies can be added later without a data migration. No currency conversion. |
| 2 | Authentication | **Better Auth, separate from Ledgio.** Email + password, users/sessions stored in our own Neon database. Self sign-up is disabled: accounts are created by an Admin. Login is rate limited (5 attempts/minute per client). Inactive members cannot sign in. |
| 3 | Compensation split mode | **One mode per project:** either all percentage splits totalling exactly 100%, or all fixed amounts totalling no more than the project value. No mixed plans. |
| 4 | Who records manual payments | **Admin only.** PMs can view the ledger but cannot record payments. |
| 5 | Reopening approved projects | **Allowed, Admin only,** with a required reason and an audit event. |
| 6 | Operating timezone | **Africa/Accra** (`APP_TIMEZONE`). All timestamps are stored in UTC and rendered in this timezone. |

## Platform choices

| Area | Choice | Reason |
|---|---|---|
| Database | **Neon** (serverless PostgreSQL) | Requested by the team. Neon branches give separate dev/staging/production databases. |
| ORM and migrations | **Drizzle ORM + drizzle-kit** | Typed schema in TypeScript, plain timestamped SQL migrations in `db/migrations/`, real transactions for the approval step. |
| DB driver | `pg` (node-postgres) | Supports interactive transactions, which the atomic approval transaction (Phase 3) needs. |
| Auth library | **Better Auth** | Neon's own auth product is built on it; keeps users in our database. Replaces Supabase Auth from the original design. |
| Hosting | **Vercel** (app) + **Neon** (data) | Minimal operations. |
| File storage | Deferred to Phase 4 | Payment evidence upload is optional; Supabase Storage is no longer in the stack. |

## Consequences for the design document

- Row Level Security: the design doc relies on Supabase's `auth.uid()`. With Neon, Phase 1 enforces permissions in the server-side permission service first and adds Postgres RLS policies that read the acting user from a per-transaction setting (`app.user_id`).
- Roles are stored on `users.role` (`TEAM_MEMBER`, `PROJECT_MANAGER`, `ADMIN`); clients can never set them through the auth API.

## Initial team and roles

Not yet provided. Development uses seeded test accounts only (`npm run db:seed`):
`admin@agod.test`, `pm@agod.test`, `member@agod.test`. Real accounts are created by an Admin once user management ships (Phase 1).
