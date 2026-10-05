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

- Row Level Security: the design doc relies on Supabase's `auth.uid()`. With Neon, domain queries run as a restricted `agod_app` role with the acting user's id in a per-transaction setting (`app.user_id`); policies look up that user's role and active flag in `users`. See `docs/PERMISSIONS.md`.
- Roles are stored on `users.role` (`TEAM_MEMBER`, `PROJECT_MANAGER`, `ADMIN`); clients can never set them through the auth API.

## Initial team and roles

Not yet provided. Development uses seeded test accounts only (`npm run db:seed`):
`admin@agod.test`, `pm@agod.test`, `member@agod.test`. Real accounts are created by an Admin once user management ships (Phase 1).

## Phase 2 decisions (2026-10-05)

| Decision | Choice |
|---|---|
| Rounding remainder (percentage plans) | Shares are floored to the pesewa; the leftover (always fewer pesewas than team members) goes to the **largest share**, ties to the member listed first. Shown in the preview. |
| Project codes | `AGOD-<year>-<nnn>`, sequential per year, assigned on creation. |
| Task assignees | Must be on the project team first. |
| Progress | Done required tasks / required tasks; waived tasks are excluded from both. Never typed in by hand. |
| Health | Overdue (past target), Blocked (a required task is blocked), At risk (an overdue task, or target within 7 days and under 80% done), else On track. |
| Split privacy | Members see who is on a project and their own split, not teammates' splits. |

## Phase 3 decisions (2026-10-05)

| Decision | Choice |
|---|---|
| Who requests approval | Members on the project, the owner, PMs and Admins. The project then locks. |
| Incomplete required tasks | Approval allowed only with an override reason, recorded in the audit event with the open tasks. |
| Invalid compensation plan | Hard blocker: no override. |
| Stale reviews | The approver approves the version they reviewed; any change in between makes the approval fail. |
| Zero-amount lines | Kept in the snapshot, no ledger entry. |
| Reopening (decision 5) | Admin only, with a reason. Current payouts are **voided** (never deleted or edited), the snapshot stays as history, and re-approval creates snapshot 2, 3, ... Refused once any payment is recorded; corrections after payment are adjustments (Phase 4). |
| Database guarantees | A project can be marked completed only by the approval transaction; ledger amounts, recipients and approval facts can never change after creation; snapshots and lines are append-only. |

## Phase 4 decisions (2026-10-05)

| Decision | Choice |
|---|---|
| Who records payments and adjustments | Admin only (decision 4). |
| Payout status | Derived from payments and adjustments by the database (Owed → Partially paid → Paid); cannot be set by hand. A fully written-off remainder counts as Paid (settled). |
| Overpayment | Refused. Pay more only after an Increase adjustment with a reason. |
| Adjustments | Increase, Decrease, Write-off (never below what was already paid), Void (only before any payment). The approved amount never changes. |
| Payment evidence | A link (e.g. to a receipt) for now. File upload waits for a storage provider decision. |
| CSV export | All ledger fields from design doc section 10, amounts in GHS with 2 decimals, formula-safe for spreadsheets. |
| Backups | Neon point-in-time restore plus a monthly encrypted `pg_dump` kept off-Neon; restore exercise before real payouts. |

## Phase 5 decisions (2026-10-05)

| Decision | Choice |
|---|---|
| Pilot environment | Staging only. Pilot data is created through the real services (`npm run pilot:seed`, or the staging-only workflow); the script refuses any target but staging or local. |
| Comparing with the spreadsheet | **Reconcile** page: paste `project_code, recipient_email, expected_owed[, expected_paid]`; matched by project code and recipient email against non-voided ledger lines. Nothing is stored. |
| Explaining amounts | Per-project **Statement** with automatic checks (ledger equals approved line, stored status equals derived status, allocations vs project value). Members see only their own lines. |
| Audit log viewer | PMs see events for projects they can view; Admins see everything (row-level security). 100 events per page with before/after differences. |
| Source of truth | The spreadsheet remains authoritative until the sign-off in `docs/PILOT.md` is complete. |
