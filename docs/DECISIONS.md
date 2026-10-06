# Phase 0 decisions

Baseline decisions for the MVP, taken from the design document
(`Project doc/AGOD Internal Project & Payout Tracker.md`, sections 12 and 15) and confirmed on 2026-10-04.
Changing any of these later needs a PR that updates this file.

| # | Decision | Choice |
|---|---|---|
| 1 | Currency | **GHS only** for the MVP. Money is stored as integer minor units (pesewas) with an ISO currency code column, so other currencies can be added later without a data migration. No currency conversion. |
| 2 | Authentication | **Better Auth, our own login.** Email + password, users/sessions stored in our own Neon database. Self sign-up is disabled: accounts are created by an Admin. Login is rate limited (5 attempts/minute per client). Inactive members cannot sign in. |
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

- Row Level Security: the design doc relies on Supabase's `auth.uid()`. With Neon, domain queries run as a restricted `agod_app` role with the acting user's id in a per-transaction setting (`app.user_id`); policies look up that user's role and active flag (since Phase 22: in their membership of the current company, `app.org_id`). See `docs/PERMISSIONS.md`.
- Roles (`TEAM_MEMBER`, `PROJECT_MANAGER`, `ADMIN`) were stored on `users.role`; since Phase 22 they are per company on `memberships.role`. Clients can never set them through the auth API.

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

## Phase 9 decisions (2026-10-05): file attachments

| Decision | Choice |
|---|---|
| Storage | Vercel Blob with **private** access (decision, Stage 2). Files are never linked directly: `/files/<id>` checks access as the signed-in person every time. Locally (not on Vercel) files go to `.data/uploads`. |
| What can have files | Projects (documents, managers upload), tasks (deliverables/evidence, managers and the assignee upload), payments (receipts, Admins upload). |
| Who sees them | Project and task files: anyone who can see the project. Receipts: managers and the person who was paid. Enforced by row-level security. |
| Limits | 4 MB per file (Vercel request limit). PDF, images (PNG, JPEG, GIF, WebP), TXT, CSV, Markdown, Office (DOCX, XLSX, PPTX) and ZIP. The content must match the extension (signatures are checked); SVG and HTML are refused. Only images and PDFs open in the browser; everything else downloads. |
| Removal | Task and project files: the uploader or a manager can remove them; removal is recorded and the stored file is kept. Payment receipts can never be removed. |

## Phase 10 decisions (2026-10-05): profitability (roadmap Stage 3)

| Decision | Choice |
|---|---|
| Revenue | The project's total value for external projects. Internal projects have no revenue: their payouts and costs show as a cost to AGOD (negative profit, no margin). |
| Payouts in profit | Before approval: the **planned** payouts from the current compensation plan. After approval: the **committed** payouts from the ledger (approved amounts plus adjustments), whether or not they are paid yet. |
| Costs | "Other project costs" (software, hosting, hardware, subcontractors, travel, marketing, other) are recorded per project with a date (not in the future) and amount. They can't be edited or deleted, only voided once with a reason, so the history stays visible. Not on cancelled projects. |
| Estimated vs actual | Estimated profit = revenue − planned payouts − cost budget. Actual profit = revenue − payouts (planned or committed) − recorded costs. Margin = profit ÷ revenue. |
| Project type | Each project has a category (Discovery, Website, Mobile app, AI integration, Internal product, Maintenance, Other) used for reporting by type. Existing projects were guessed from their names; the PM can change it. |
| Who | Project Managers and Admins see and record finance data; Team Members never see it (row-level security on costs). |
| Payout forecast | Owed now and awaiting approval fall in the current month; in-progress projects in the month of their target date (current month if past or unset); anything beyond the window is shown as "later". |
| Payout aging | Unpaid balances grouped by days since the project was approved: 0–30, 31–60, 61–90, over 90. |
| Utilisation | Estimated hours of tasks completed in the month ÷ (weekly capacity × weeks in the month). Tasks without an estimate are counted separately. |
| Frontend | Backend-first: the pages are plain tables; the redesign builds on the services listed in `docs/FRONTEND_CONTRACT.md`. |

## Phase 11 decisions (2026-10-05): AGOD share

| Decision | Choice |
|---|---|
| What | Each percentage-split project has an **AGOD share**: the percentage the company keeps. Team percentages must total 100% minus the share (e.g. 30% AGOD + 70% team). New projects are pre-filled with 30%; the PM can change it while the project is editable. |
| Existing projects | Kept at 0%, so their plans and approvals are unchanged. |
| Fixed amounts | No share percentage (the database refuses one); AGOD keeps whatever the fixed amounts leave, shown explicitly in the preview. |
| Rounding | With an AGOD share, team members get their exact floored amounts and any leftover pesewas stay with AGOD. With 0%, the old rule applies (remainder to the largest share). |
| Record | The approval snapshot stores the share percentage and amount (calculation version 2) and its notes say what AGOD kept. The project statement checks team lines + AGOD share = project value. |
| Profit | No change to the profit rules: the AGOD share is simply what is left after payouts, so profit = AGOD share − other costs. |

## Phase 16 decisions (2026-10-05): customers and contacts

| Decision | Choice |
|---|---|
| What | A **customer** record per client: name, type (company, individual, partner, other), status (prospect, active, paused, churned, archived), account owner (a PM or Admin), optional reference in another system, and notes. Each customer has **contacts** with email and/or phone, a preferred channel, and primary/billing flags. |
| Projects | Every external project links to a customer; internal projects have none (enforced by the database). `client_name` stays on the project as a copy of the customer's name and is updated when the customer is renamed, so reports, statements and exports are unchanged. |
| Picking a customer | The project form offers the existing customers or "+ New customer…" with a name. A typed name that matches an existing customer (case and spaces ignored) links to it instead of creating a duplicate. |
| Existing projects | The migration created one customer per distinct client name of external projects (owner: the owner of that client's first project) and linked the projects. |
| Duplicates | Customer names are unique, ignoring case and surrounding spaces. |
| Nothing is deleted | Customers are archived (with a reason, only once their projects are completed or cancelled) and can be restored; contacts are deactivated. Archived customers take no new projects or contact changes. The database refuses deletes. |
| Primary contact | At most one active primary contact per customer; the first contact becomes primary, and marking another one primary moves the flag. |
| Who | Project Managers and Admins see and manage customers and contacts (row-level security). Team Members only see the client name on their own projects. |
| History | Customer and contact changes are in the audit log and on the customer page; PMs can read them as well as Admins. |

## Phase 17 decisions (2026-10-05): services and subscriptions

| Decision | Choice |
|---|---|
| Services | A catalogue of what AGOD sells: a short unique code (e.g. HOSTING-STD), name, description, default billing and optional default price. Services are retired, not deleted; a retired service stays on its subscriptions but can't be picked for new ones. Editing a service never changes existing subscriptions. |
| Subscriptions | One customer's commitment to one service, with its own agreed terms: price (per period, per unit), quantity, billing (one-time, monthly, quarterly, annual, custom), pricing basis, start date, optional end date (empty = open-ended), optional renewal date, notice period, payment terms, owner and optional renewal owner, contract reference and notes. The service name is copied in when it is created. |
| Statuses | Draft → Active ⇄ Paused → Ended or Cancelled. Drafts can also be cancelled. Pausing, ending and cancelling need a reason. Ended and cancelled are final (the database refuses changes); selling again means a new subscription. No "pending approval" step for now. |
| Changing terms | Drafts are edited freely. Once active or paused, price, quantity, billing, basis, end/renewal dates, notice period and payment terms change only through an **amendment** with an effective date and a reason; the amendment stores the old and new values and can't be edited or deleted. Owners, reference and notes are edited directly (audited). |
| Dates | End date ≥ start date; renewal date between start and end (checked in the form and by the database). |
| Monthly recurring value | Active subscriptions only: price × quantity, quarterly ÷ 3, annual ÷ 12 (rounded to the pesewa). One-time and custom billing are not counted. Paused subscriptions don't count. |
| Renewal due | A live subscription needs attention from its notice period before the renewal date (or the end date if there is no renewal date), is overdue after it, and is flagged if its end date has passed. Shown as badges and a filter; reminders and a daily job come in the next phase. |
| Customers | A customer can't be archived while it has draft, active or paused subscriptions. |
| Not included | Invoicing, payment collection, tax, usage metering and proration. Subscription income is not yet in Profitability. |
| Who | Project Managers and Admins (row-level security); Team Members see none of it. |

## Phase 18 decisions (2026-10-06): renewals and recurring revenue

| Decision | Choice |
|---|---|
| Reminders | In-app, like the task and approval alerts: generated when a PM or Admin opens the Dashboard or My work, each sent once (dedupe key includes the date), so no scheduler is needed. The renewal owner (or the owner when none is set) is told when the notice period starts, when the renewal date passes without a decision, and when a live subscription is past its end date. Admins are told about anything a week overdue. Email/WhatsApp delivery would need a scheduled job and a provider. |
| Renewing | "Record a renewal" moves the renewal date (and the end date, if any) forward, by default one billing period (one year for one-time and custom billing), optionally at a new price, with a note of what was agreed. It is stored as an amendment marked **Renewal**, effective on the old renewal date, so the previous terms stay visible. A reminder never renews anything by itself; not renewing means ending or cancelling the subscription with a reason. |
| Renewals view | Dashboard card (next 60 days and anything overdue) and a "renewing within 30/60/90 days" filter on Subscriptions. |
| Recurring revenue | A Profitability tab: monthly recurring value and annual run rate (× 12) of active subscriptions, by service and by customer, and what renews in the next 90 days. Agreed value, not invoiced or collected money; it is kept separate from project profit. |

## Phase 19 decisions (2026-10-06): email reminders

| Decision | Choice |
|---|---|
| What is emailed | One daily summary per person of their unread in-app notifications (all kinds: tasks, approvals, payouts, renewals, comments) from the last 7 days that weren't emailed before. No email on days with nothing new. Each notification is emailed at most once; the 7-day limit stops a backlog going out when email is first turned on. |
| When | Vercel Cron at 06:00 UTC (= Accra) daily calls `/api/cron/daily`, protected by `CRON_SECRET`. The job first creates everyone's task, approval and renewal reminders (as each person, under their own permissions), so reminders no longer depend on people opening the app. Vercel runs crons for production only; Admins can run the job on demand from Integrations. |
| Provider | SMTP through Nodemailer, set by `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM`, so any mail provider works (Gmail/Google Workspace with an app password to start). Messages never read files or URLs (`disableFileAccess`/`disableUrlAccess`). Without SMTP settings email is off and the app behaves as before. A local file outbox (`EMAIL_OUTBOX_DIR`) is for testing and never used on Vercel. |
| Reliability | Notifications are claimed (marked emailed) before sending and released if sending fails, so a retried or overlapping run never double-sends and a failure is retried next day. Each run is recorded (`job_runs`) and shown to Admins. |
| Opt-out | Each person turns the daily email off or on from Account (their own preference row, protected by row-level security). On by default. |
| Not included | Instant (per-event) emails, SMS/WhatsApp, per-type email settings. |

## Phase 20 decisions (2026-10-06): invoices

| Decision | Choice |
|---|---|
| Lifecycle | **Draft** (edited freely, can be deleted; no number yet) → **Issued** (gets the next number `INV-<year>-<nnnn>`, copies the bill-to name and email, and is frozen) → optionally **Void** (with a reason, only while no payments are recorded). Open, partly paid, paid and overdue are worked out from payments and the due date. A correction is a void plus a new invoice; there are no credit notes yet. |
| Lines | Manual lines (description × quantity × unit price), the next unbilled **period of a subscription** (one billing period at the subscription's price; one-time billed once; custom billing as a manual line), or an amount for a **project** of that customer (deposit, milestone, balance). The database refuses billing the same subscription period twice, and the service refuses billing more than a project's value. Voiding frees what the invoice billed. |
| Subscription billing | "Prepare subscription invoices" creates one draft per customer with every active subscription's next period starting by a chosen date (default: in 7 days). Nothing is sent until each draft is issued. |
| Who | PMs and Admins create, issue, email and void invoices. Only **Admins** record or void customer payments and edit the invoice settings (like decision 4 for payouts). Team Members see nothing. Row-level security and triggers enforce the same. |
| Payments | Recorded manually (amount, date not in the future, method, reference), never more than the balance; partial payments allowed. Payments are voided with a reason, never deleted or edited. |
| PDF and email | The PDF is generated on the server (pdf-lib, built-in Helvetica; characters outside its set print as "?"). "Send by email" attaches it and goes to the billing contact copied at issue (or another address), over the SMTP settings from Phase 19; it records when and to whom. |
| Settings | Business name, address, contact details, tax ID, payment instructions (bank, MoMo), footer and default payment terms (14 days), printed on every PDF, including invoices issued earlier. |
| Reminders | Overdue invoices remind the customer's account owner (once per due date); Admins are told after 14 days. In the app, the daily email and a Dashboard warning. |
| Not included | Tax/VAT lines, discounts, credit notes, online card or MoMo collection, multi-currency invoices, recurring auto-issue. |

## Phase 21 decisions (2026-10-06): Google Drive

| Decision | Choice |
|---|---|
| Account | The team uses personal Gmail, which has no shared drives, so an **Admin connects one team Google account** (OAuth, offline access, PKCE). The app keeps an **AGOD** folder there with a folder per customer (with *Invoices*), per project (internal projects under *Internal projects*) and *Payment receipts*. One company account at a time; reconnecting the same account keeps its folders and files. |
| Permission scope | `drive.file` only: the app sees nothing in that Drive except what it created. `calendar` is requested at the same time for Phases 22–23. |
| Sharing | AGOD: Editor for every active PM and Admin. Project folders: Editor for the project's team members (owner, assigned people, task assignees), as the app's own project visibility rule. Synced daily and on demand; the app removes only access it granted. Shared with the email people sign in with (later: their connected Google account). No notification emails from Drive. |
| Files | When Drive is connected, new uploads go to Drive (`gdrive:<connection>:<file>` storage key) and are still served through `/files/<id>` with the same access checks; earlier files stay in Blob. If Drive refuses, the upload falls back to Blob when it is configured. Issued invoice PDFs are saved to the customer's *Invoices* folder (best effort; retry button). |
| Links | Links (https only) to Google Docs/Sheets/Slides/Drive or other pages on a project (managers) or a task (managers and the assignee); removed softly by whoever added them or a manager; visible with the project. |
| Security | The refresh token is encrypted (AES-256-GCM, key derived from `BETTER_AUTH_SECRET`). Tokens and folder ids live in tables the app role cannot read at all; the server reads them through the owner connection after its own permission checks. The OAuth attempt (state, PKCE verifier, who started it) is kept in an encrypted, httpOnly, 10-minute cookie. |
| Not included | Shared drives (Google Workspace), browsing Drive from the app, two-way sync of files added in Drive, per-person Drive accounts (Phase 22 adds personal Google connections for calendars). |

## Phase 22 decisions (2026-10-06): companies (multi-tenant)

| Decision | Choice |
|---|---|
| Why now | The product will be offered to other companies and developers. Done before go-live, while there is no real data, with AGOD as the first company (all existing data moved into it). |
| Model | One shared database. Every company-owned table has `organization_id`, defaulted from the current company. A person has one login and a **membership** per company with its own role, active flag and capacity. |
| Separation | Enforced by PostgreSQL for the app role: a restrictive policy per table (`organization_id = app_org_id()`), roles read from the membership in the current company, a trigger refusing cross-company references, and company checks inside functions that bypass row-level security. An integration test checks every company-owned table. |
| Membership | People can belong to several companies, with a company switcher (choice remembered per browser; default is the company joined first). Deactivating someone ends access to that company only. |
| Accounts | Admins add people by email; an existing login is added without a new password. Admins reset passwords only for people in no other company. Every company keeps at least one active Admin. |
| Numbering | Project codes use a per-company prefix (default from the company name, editable by Admins; existing codes unchanged), sequential per company and year. Invoice numbers are sequential per company. |
| System work | The daily job runs per company (one run record and one email per person per company). GitHub webhook rows go to each affected project's company. Google Drive is connected per company. GitHub deliveries are platform-wide; each company sees only its own repositories'. |
| Creating companies | `npm run admin:create` or the GitHub workflow (company + first Admin) until self sign-up (Phase 23). New companies get the starter templates and invoice settings. |
| Product name | Will become **Ghana Vibe Coders & Developers** (Phase 23 sign-up pages); inside the app the sidebar shows the company's name. |
| Not included | Self sign-up, invitations by email and password reset by email (Phase 23); billing; a platform admin view; per-company time zone and currency (still Africa/Accra and GHS by default). |

## Phase 23 decisions (2026-10-06): sign-up, invitations, password reset

| Decision | Choice |
|---|---|
| Product name | **Ghana Vibe Coders & Developers** on public pages, the browser title and account emails (`src/lib/brand.ts`). Inside the app the sidebar shows the company's name. |
| Sign-up | Open when `ALLOW_SIGNUP=true` and email works. Name, company, email, password (10+ characters). The company is created only when the email is confirmed (Better Auth email verification, link valid 24 hours), so unconfirmed or borrowed addresses never get a company. Unconfirmed accounts can't sign in; trying sends a new link. |
| Existing emails | Sign-up with an address that already has an account shows the same message and changes nothing; the owner is emailed. |
| Invitations | With email set up, new people get an invitation link to choose their password (7 days, single use, Better Auth's password-reset tokens) instead of an Admin-relayed temporary password; existing logins get an "added to company" email; "Send a password link" replaces "Reset password". Without email, temporary passwords as before. |
| Forgot password | Self-service by email (link 1 hour, single use); resetting signs out other sessions. |
| Abuse limits | Per-IP limits: 5 sign-ups and 5 reset/verification emails an hour, 5 sign-in and reset attempts a minute. |
| Not included | Social sign-in (Google), CAPTCHA, deleting unconfirmed accounts automatically, billing. |

## Phase 24 decisions (2026-10-06): Google Calendar

| Decision | Choice |
|---|---|
| Company calendar | One calendar per company, created by the app in the company Google account (the `calendar` permission already asked for in Phase 21): project target dates, open milestones, open task due dates, renewals and unpaid invoice due dates, as all-day events marked "free", from a month back to a year ahead. |
| Who sees it | Shared view-only with active PMs and Admins only, because it shows every project; access the app gave is removed when someone stops being a manager. Team Members get their own calendar instead. |
| Personal calendars | Optional, per person, from the Account page, with the narrow `calendar.app.created` permission (the app sees only the calendar it creates). Holds the person's own open tasks with due dates. Their Google address is then used for the company calendar and meeting invitations. |
| Project meetings | Scheduled by managers on a project; a Google Calendar event in the company calendar with a Meet link, invitations sent by Google to the project owner, assigned team and task assignees. Recorded in `project_meetings` (visible to whoever can see the project). Cancel only, no editing; no deletion. |
| Sync | Daily job, *Sync now* buttons and on connecting. The app keeps a mapping of the events it made and only rewrites changed ones; it never touches events it didn't create. Times use the operating time zone (Africa/Accra). |
| Not included | Reading people's free/busy times, editing meetings, recurring meetings, two-way sync (changes made in Google aren't read back), meetings outside projects. |

## Phase 25 decisions (2026-10-06): community foundation

| Decision | Choice |
|---|---|
| Where | In the same app, not a separate site: one login, one brand, and reuse of sign-up, email, Google Meet and files. The public pages (home, members, profiles, code of conduct) are the front door; company workspaces stay private behind them. |
| Joining | Sign-up makes a community member; a company workspace is optional (at sign-up or later from the community home). Agreeing to the code of conduct is part of sign-up. |
| Profiles | One per person, platform-wide. Self-joined members start public; people added to a company start visible to signed-in members only. Email never shown. Links must be https and open with `nofollow ugc`. |
| Roles | Builder (everyone), Reviewer (self-selected), Organizer (first ones from `COMMUNITY_ORGANIZER_EMAILS`, then appointed by organizers). Separate from company roles. |
| Moderation | Reports with a reason; organizers hide (with a note) or dismiss; hidden profiles remain visible to their owner and organizers. |
| Data | `member_profiles`, `community_reports`: no company, server-only (no app-role access). |
| Chat | Stays on Discord and WhatsApp (links configurable); not built into the app. |
| Marketing | The community is free; the company workspace is offered where it helps (community home, sign-up option, home page), free while testing. |
| Not included | Showcase posts, review requests, teaching sessions, mentorship matching, library (next phases); profile photos; blocking members. |

## Phase 26 decisions (2026-10-06): showcase and reviews

| Decision | Choice |
|---|---|
| Posts | The handbook's template (name, one-line pitch, audience, built with, AI-built, links, video demo, feedback areas and questions, what they need). A live preview card on the form. Five posts a day per member. |
| Media | Up to four screenshots (images only, 4 MB, signature-checked) in the existing file storage, served through the app with a locked-down policy. Video demos are links (Loom, YouTube, Drive), not embeds or uploads: cheaper on data and storage. |
| Safety | The handbook's code safety checklist is required on every post and edit. |
| Review status | Needs review → Reviewed (automatically on first feedback) → Shipped (author). |
| Feedback | Structured as the handbook says (what works, to improve, next step); one per person and project; author can reply once; author emailed on new feedback. |
| Give back | Counts shown, not enforced (posting isn't blocked when you haven't reviewed). |
| Moderation | Reports extended to projects and feedback; organizers hide or dismiss; authors take their own projects down. |
| Not included | Comments threads, likes or votes (project of the month comes in Phase 28), embedded video, editing feedback. |

## Phase 26.1 decisions (2026-10-06): storage savings

| Decision | Choice |
|---|---|
| Compression | In the browser before upload (1600 px, WebP; JPEG fallback; GIF unchanged). Free (no server work), saves members' data, strips photo metadata. The server still checks type, signature and the 4 MB limit; no server-side image processing (no native image library available on the platform build). |
| Duplicates | SHA-256 fingerprint per showcase screenshot; identical pictures share one stored file (content-addressed key); stored showcase files are never deleted, so sharing is safe. Company attachments keep one file each (they can be deleted). |
| Storage | S3-compatible driver (Cloudflare R2 recommended: free allowance, no download fees) selected by settings, ahead of Vercel Blob; keys prefixed `s3:` so older Blob files remain readable. Signed with `aws4fetch` (small, no AWS SDK). |
| Video | Links only (YouTube unlisted, Loom, Drive), as in Phase 26. |

## Phase 26.2 (2026-10-06): when email fails

| Decision | Choice |
|---|---|
| Invitation email fails | The new person gets a temporary password the Admin passes on (as without email), so nobody is locked out; the Admin sees why the email failed. |
| Password link fails | Same fallback, except for people who also belong to another company (no company may set their password): they use *Forgot password* once email works. |
| Error message | A refused SMTP login explains the fix (Gmail: an App password in `SMTP_PASS`, full address in `SMTP_USER`, redeploy). |

## Phase 27 decisions (2026-10-06): teaching sessions

| Decision | Choice |
|---|---|
| Who hosts | Reviewers (self-chosen badge) and organizers, after the code of conduct; five upcoming sessions per host. |
| Calls | The host's own Google Meet, Zoom or Discord link, as the handbook says; the app doesn't create calls (members without a company have no Google connection). |
| Privacy | The call link is shown only to the host, people who joined and organizers, to keep strangers out of calls. |
| Calendar | A standard .ics file (attached to emails and downloadable), so it works with any calendar without connecting accounts. |
| Emails | Confirmation on joining, a reminder from the daily job for sessions in the next 24 hours, and emails on time/link changes and cancellations. |
| Archive | The host adds a recording link and notes after the session; past sessions are listed with them. |
| Not included | Waitlists, recurring sessions, in-app video, attendance tracking. |

## Phase 28 decisions (2026-10-06): roles, job titles, two people for money

| Decision | Choice |
|---|---|
| Roles | Built-in Team Member, Project Manager and Admin stay (unchangeable). A company makes its own roles by copying one and switching **permission groups** off (12 groups, e.g. "Pay the team", "Approve finished projects"). A company role can only narrow its starting role, never widen it. |
| Enforcement | The application checks the role's groups. Row-level security keeps enforcing the starting role, which the database copies onto the membership (a trigger), so a bug can never give more than the starting role. What data someone sees (all projects or only their own) follows the starting role. |
| Safety | Always one active Admin with the full built-in role (database guard). Nobody changes their own role, hands out access they don't have, or changes/deactivates/sets a temporary password for someone with more access. Role, job title and setting changes are audited. |
| Job titles | Each company's own list; they grant nothing. "Role on project" is picked from the list (pre-filled from the person's title); free text remains when a company has no titles. |
| Team type | "What kind of team are you?" (Software, Fintech, Other) on the Roles page (and when creating a company from the community): adds suggested titles and roles (Team Lead, Finance, and Compliance for fintech), only what's missing. The dashboard asks until the company has job titles. |
| Two people for money | On for new companies: nobody approves a project that pays them or that they asked to have approved, and nobody records a payment or adjustment on their own payout (the database refuses the payout and payment rows too). A one-manager company may switch it off on the Company page, with a reason (audited). Companies that existed before Phase 28 start with it off, so nothing breaks; Admins should switch it on. |
| Password reset | Completing a reset link also confirms the email (and finishes sign-up), since it proves the person owns the address. |
| Wording | "AGOD share" is now "company share" in the app, since every company uses it. |

## Phase 29 decisions (2026-10-06): client money flow

| Decision | Choice |
|---|---|
| Payment plan | Per client (external) project: stages of kind Deposit, Milestone, Final or Change, in amounts (pesewas) that never add up to more than the project's value. Presets 50/50 (the company's usual deposit), 40/30/30, 100% upfront, 100% on completion; the last stage takes the rounding remainder. Presets replace only stages not yet invoiced; change payments stay. |
| Invoicing | One draft invoice per stage, for the project's customer, from the Billing tab (`invoice.manage`). The stage's status follows its invoice: not invoiced, draft, invoiced, part paid, paid. A voided invoice frees the stage. An invoiced stage keeps its amount and is never deleted (database guard). |
| Deposit rule | Company setting "No deposit, no work" (off by default): a client project can't move from Planning to In progress until its deposit stage is paid. A manager may start anyway with a written reason, recorded in the audit log. |
| Client sign-off | Recorded by a manager on each stage: when the work went for review, and when and how the client accepted (e.g. "Email from Ama"). The answer deadline is the company's review days in working days (default 10, Mon–Fri, holidays not counted). Silence is not turned into acceptance automatically; the page says when the time is up. No client portal yet. |
| Change requests | Draft → sent → approved or rejected (with date and how the client decided). Approval needs the project to be editable; it adds the price to the project's value (so percentage splits grow with it), adds a Change payment to the plan, and moves the target date by the extra days. Decided requests never change (database guard). |
| Paying the team | Company setting: on approval (default, as before) or in step with the client. In step: for a client project, a payout can be paid up to owed × (client paid ÷ project value), whole pesewas rounded down; internal projects are paid on approval. Client paid = each issued invoice's payments shared across its lines in proportion. Enforced in the app and by a database trigger (`app_payout_releasable`). |
| Who | Plans, sign-off and change requests: "Create and edit projects". Invoices: "Invoices". Settings: "Company settings". Team members never see a project's billing. |
| Not included | Withholding tax and VAT on client payments (tax rates as settings come later, after advice), online client sign-off links, automatic reminders to clients. |

## Phase 30 decisions (2026-10-06): messages

| Decision | Choice |
|---|---|
| What | Private conversations inside a company: one-to-one (one per pair, reused) and groups of up to 10 people with an optional name. Project discussion stays on the project's Discussion tab. The community keeps Discord and WhatsApp (Phase 25); this is for a company's own team. |
| Privacy | Only the people in a conversation can read or write in it, whatever their role: Admins can't read other people's messages (row-level security). Messages can't be edited or deleted. The page reminds people not to share passwords or payout amounts. |
| Who | Anyone active in the company can message anyone active in it. People added later can't join an existing conversation (start a new group). Nobody can write into a conversation whose other people have all left. |
| Unread | Per person and conversation, from their last read time. The icon (sidebar and phone top bar) checks every 30 seconds while the page is visible; an open conversation refreshes every 10 seconds. No WebSockets or paid real-time service. |
| Reminders | The daily job adds one notification a day when someone has messages unread for over an hour; it shows in My work and goes out in the daily email (which people can turn off), linking to the conversation. |
| Not included | Attachments, reactions, editing, read receipts, typing indicators, push notifications, adding people to existing conversations, clients in conversations. |

## Phase 31 decisions (2026-10-06): mentorship, tools & prompts library, project of the month

| Decision | Choice |
|---|---|
| Who mentors | Reviewers who switch on "open to mentoring", for 1 to 5 people at once, with a note on what they help with. |
| Matching | Simple and explainable: mentors with space first, then shared tools (2 points each) and the same city (1 point). The card says why it's a good match. No algorithmic profiling. |
| Asking | A member asks with a goal (10 to 500 characters); at most 2 open requests or mentorships at a time; one open request per mentor. The mentor accepts (only with space) or declines, with an optional note. |
| Contact | Accepting shares both email addresses (both agreed); before that, no email is shown. Meetings happen outside the app (call, WhatsApp, meet-up). |
| Library | Tools and guides need a link; prompts need the text (no passwords or personal data, the form says). Tags, "works on slow internet", "free". "Useful" marks (one per member, not on your own). Organizers feature and hide; 10 new items a day per member. Public, so visitors learn too. |
| Project of the month | One vote per member per month (Accra time), movable until the month ends, never for your own project. The month's leader wins; ties go to whoever reached the count first. Organizers can override with a note (shown). Settled by the daily job, and lazily by the first page that shows it. |
| Not included | Mentorship sessions tracking, ratings of mentors, comments on library items, prizes. |
