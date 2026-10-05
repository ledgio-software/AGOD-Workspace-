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

## Phase 6 decisions (2026-10-05): roadmap Stage 1 gaps

Source: `Project doc/AGOD Project, Operations & Payout System - Roadmap.md`. Status of every roadmap item: `docs/ROADMAP.md`.

| Decision | Choice |
|---|---|
| Health override (2.2) | PMs and Admins may replace the calculated health with On track / At risk / Blocked / Overdue, always with a reason (enforced by the database). It stays until cleared; the calculated health is shown next to it. Not available on completed or cancelled projects. |
| Deadline alerts (2.4) | In-app only: "due soon" (due today to 2 days ahead) and "overdue" to the assignee, plus "overdue task" to the project owner. Created when the person opens Dashboard or My work, so no scheduler is needed while alerts are in-app; each alert is sent once per task and due date. Email/Slack/WhatsApp later would need a scheduled job. |
| Contribution history (2.3) | `/team/<person>`: projects and roles (including removed ones), open and completed work, payouts, payments and adjustments, and current workload. Managers can open anyone's; members only their own (linked from My work). |
| Payout questions (2.8) | A member asks about their own payout; the ledger is never touched by asking. The project owner is notified. A PM either answers with no change (closes it) or sends it to the Admins; only an Admin settles it, optionally recording an adjustment in the same step, which is linked to the question. Payout status stays derived from payments and adjustments (the unused `DISPUTED` status is not set). A PM cannot review their own question. |
| Month close (2.9) | Calendar months in Africa/Accra. The checklist shows projects approved in the month, outstanding balances, payments dated in the month, adjustments made in the month, unresolved questions, and a CSV export. Only finished months can be closed, only by Admins. A closed month refuses payments dated in it (database trigger); reopening needs a reason and is audited. |

## Phase 7 decisions (2026-10-05): roadmap Stage 2, part 1

Stage 2 is split into Phase 7 (no outside services), Phase 8 (GitHub integration through a GitHub App) and
Phase 9 (file attachments in Vercel Blob).

| Decision | Choice |
|---|---|
| Comments and mentions | A discussion on each project, optionally about one task. Anyone who can see the project can read and post; comments are never edited or deleted. Mention people on the project with `@Full Name` or `@emailname`; mentioned people, the project owner and the task's assignee get an in-app notification. People outside the project cannot be mentioned. |
| Templates | Plain-text outlines (`# Milestone`, `- Task \| +10d \| 12h \| optional`) managed by PMs and Admins. Six starter templates for the roadmap's project types. Applying a template adds milestones and **unassigned** tasks to an editable project, with due dates counted from the project start date (or today). Any project can be saved as a new template. Templates are deactivated, never deleted. |
| Estimates and capacity | Optional whole-hour estimates on tasks (set by managers only). Each person has a weekly capacity (default 40 hours, 0 for leave), set by Admins on the Team page. |
| Workload | Per person: open, in-progress, blocked, overdue and due-this-week tasks, tasks without an estimate, and "planned" hours (estimates of tasks due in the next 7 days or overdue) against capacity. Unassigned open tasks are counted separately. |
| Approval reminders | In-app, generated like deadline alerts: the project owner after 2 and 7 days in "pending approval", Admins after 7 days. A new approval request restarts the clock. |
| Weekly summary | Monday to Sunday (Africa/Accra). Completed tasks by person, newly blocked tasks, approvals, payments and adjustments for the week, plus blocked, overdue, at-risk and due-next-7-days items as of today. Also as plain text to paste into WhatsApp, Slack or email. Managers only. |

## Phase 8 decisions (2026-10-05): GitHub integration (roadmap 2.5)

| Decision | Choice |
|---|---|
| Connection | A GitHub App per environment on the `ledgio-software` organisation (setup: `docs/GITHUB_APP.md`). Optional: without its three settings the app works as before, and links can still be pasted by hand. |
| Task keys | Every task gets a per-project number; the key is `<project code>-T<number>` (e.g. `AGOD-2026-005-T3`). A pull request or issue mentioning the key in its branch, title or body links itself to the task. |
| Repository | Each project is connected to one repository (`owner/name`). The webhook only links and moves tasks in projects connected to the event's repository. |
| New task statuses | **In review** (pull request open) and **Ready for QA** (merged, waiting for the PM). Both count as open work. Members can also set them by hand. |
| Automatic moves | Draft PR: Not started → In progress. PR opened: Not started/In progress → In review. Merged: anything except Done/Waived → Ready for QA (the project owner is asked to verify). Closed without merge: In review → In progress. The PM marks Done after verifying on staging. Done and Waived are never changed automatically; projects not accepting task updates are left alone. |
| System changes | The webhook writes through the owner connection as the system (no signed-in person), with audit events whose actor is empty and whose reason names the pull request. Deliveries are recorded once (`github_deliveries`) and processed in one transaction, so a failure can be redelivered. |
| Deployments and releases | Recorded from `deployment_status` and `release` events (Vercel reports its deployments to GitHub). A merged pull request shows where its merge commit has been deployed. |
| Links by people | Managers link any task and remove links; members link their own tasks. PMs can create a GitHub issue for a task in the project's repository. |
