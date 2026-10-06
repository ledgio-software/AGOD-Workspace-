# How permissions work

Every protected action is checked twice: once in application code, once by PostgreSQL.
A bug in one layer is caught by the other.

| Layer | Where | What it does |
|---|---|---|
| 1. Permission service | `src/lib/permissions` | `can(actor, action, resource)` / `assertCan(...)`: the role rules from the design doc (section 4) and `docs/DECISIONS.md`. Pure function, fully unit-tested. |
| 2. Row-level security | `db/migrations/*_row_level_security.sql`, `*_organizations_rules.sql` | Domain queries run as the `agod_app` role in one company (`app.org_id`). A restrictive policy on every company-owned table hides other companies' rows; the other policies decide which rows each person can read or write, using their role and active flag from their membership in that company (`docs/COMPANIES.md`). |
| Integrity triggers | same migration | Audit events, compensation snapshots, snapshot lines, payments and adjustments are append-only for everyone. Members may change only progress fields of their own tasks. |

The UI hides what a role can't use, but that is convenience only; the server and database are the gates.

## Rules for new features

1. **Check first:** start every service function with `assertCan(actor, "<action>", context)`.
   Add new actions to the `Action` type and the matrix test in `permissions.test.ts`.
2. **Query as the user:** run domain reads and writes inside `withActor(actor, async (tx) => ...)`.
   Never use the plain `db` connection for domain data; it is reserved for Better Auth, migrations and scripts.
3. **Audit material changes:** call `recordAudit(tx, ...)` with the same `tx`, so the event commits with the change.
   Approvals, rejections, payments, adjustments, reopenings and role changes must always be audited.
4. **Mirror the rule in SQL:** a new table needs `ENABLE ROW LEVEL SECURITY`, grants for `agod_app`
   (no `DELETE` for financial data) and policies, in a new migration. Company-owned tables also need
   `organization_id`, a restrictive `_tenant` policy and an `app_same_org` trigger (`docs/COMPANIES.md`).
5. **Test both layers:** a unit test for the rule and an integration test in `tests/integration/`
   showing the database refuses the action on its own.

## Who can do what

| Action | Team Member | Project Manager | Admin |
|---|:---:|:---:|:---:|
| View projects | own only | all | all |
| Create/edit projects, compensation | | ✓ | ✓ |
| Request approval | own projects | ✓ | ✓ |
| Approve / reject | | ✓ | ✓ |
| Reopen approved project | | | ✓ |
| Update a task | own tasks (progress only) | ✓ | ✓ |
| View compensation splits | own split only | all | all |
| View payouts | own only | all | all |
| Record payments, adjustments | | | ✓ |
| Export ledger | | ✓ | ✓ |
| View team | | ✓ | ✓ |
| Manage team (add, roles, deactivate, reset password) | | | ✓ |
| Audit log | own actions | projects they can see | all |
| Override project health (with a reason) | | ✓ | ✓ |
| Contribution history | own | everyone | everyone |
| Ask about a payout | own payouts | own payouts | own payouts |
| Review payout questions (answer, or send to Admin) | | ✓ (not their own) | ✓ |
| Settle a payout question with an adjustment | | | ✓ |
| Month close: view checklist and export | | ✓ | ✓ |
| Month close: close or reopen a month | | | ✓ |
| Read and post project comments | projects they can see | ✓ | ✓ |
| Manage and apply templates | | ✓ | ✓ |
| Set task estimates | | ✓ | ✓ |
| Set weekly capacity | | | ✓ |
| Workload view, weekly summary | | ✓ | ✓ |
| Link a GitHub item to a task | own tasks | ✓ | ✓ |
| Remove a GitHub link, connect a repository, create a GitHub issue | | ✓ | ✓ |
| GitHub integration page (status, deliveries) | | | ✓ |
| Upload project documents | | ✓ | ✓ |
| Upload task files | own tasks | ✓ | ✓ |
| Upload payment receipts | | | ✓ |
| See payment receipts | own payouts | ✓ | ✓ |
| Remove a file (not receipts) | own uploads | ✓ | ✓ |
| Profitability, payout forecast and aging, utilisation; CSV export | | ✓ | ✓ |
| Set project type and cost budget; record or void project costs | | ✓ | ✓ |
| Customers and contacts: view, add, edit, archive or restore | | ✓ | ✓ |
| Services and subscriptions: view, create, amend, change status | | ✓ | ✓ |
| Invoices: view, create, issue, email, void | | ✓ | ✓ |
| Record or void customer payments on invoices; invoice settings | | | ✓ |
| Add a link (Google Drive or web) | own tasks | ✓ | ✓ |
| Remove a link | own links | ✓ | ✓ |
| Create a project's Drive folder now; save an invoice to Drive | | ✓ | ✓ |
| Connect, disconnect or sync the team Google account (`google.manage`) | | | ✓ |
| See the company calendar in Google (shared view only) | | ✓ | ✓ |
| Connect, sync or disconnect your own Google Calendar (Account page) | ✓ | ✓ | ✓ |
| See a project's meetings and join with Google Meet | own projects | ✓ | ✓ |
| Schedule or cancel a project meeting (`project.edit`) | | ✓ | ✓ |
| Company name and project code prefix (`company.manage`) | | | ✓ |

### Company-made roles (Phase 28)

The table above is the built-in roles. A company can make its own roles on **Team › Roles & job
titles** by copying a role and switching permission groups off. The groups (`PERMISSION_GROUPS` in
`src/lib/permissions`) are:

| Group | Actions | Lowest built-in role with it |
|---|---|---|
| Create and edit projects | `project.create`, `project.edit`, `project.configureCompensation`, `project.overrideHealth`, `template.manage`, `task.update` (any task) | Project Manager |
| Approve finished projects | `project.approve`, `project.reject` | Project Manager |
| Reopen approved projects | `project.reopen` | Admin |
| See everyone's payouts | `payout.viewAll`, `ledger.export`, `period.view`, `payoutQuestion.review` | Project Manager |
| Pay the team | `payment.record`, `adjustment.create`, `payoutQuestion.resolve`, `period.close` | Admin |
| See the team | `team.view`, `workload.view`, `report.weekly` | Project Manager |
| Manage people and roles | `team.manage` | Admin |
| Profitability and costs | `finance.view`, `finance.manage` | Project Manager |
| Customers and subscriptions | `customer.*`, `subscription.*` | Project Manager |
| Invoices | `invoice.view`, `invoice.manage` | Project Manager |
| Customer payments | `invoice.recordPayment`, `invoice.settings` | Admin |
| Company settings | `company.manage`, `google.manage`, `audit.viewAll` | Admin |

`can()` first applies the built-in rule for the starting role, then the role's list of groups;
with a group off, people keep only their own work (their own tasks). The actor's `permissions` are
loaded from `company_roles` on every request (`src/lib/session.ts`), so changes apply on the next
page. Row-level security still enforces the starting role. Pages that call several services must
check each service's permission (a role may have one and not the other).

**Two people for money** (database triggers `payout_ledger_entries_not_self`,
`payment_transactions_not_self`, `adjustments_not_self`, plus the approval service): unless the
company allows it, nobody approves a project that pays them or that they asked to have approved, and
nobody records a payment or adjustment on their own payout.

### Client billing (Phase 29)

| Action | Team Member | Project Manager | Admin |
|---|:---:|:---:|:---:|
| See a client project's Billing tab (plan, sign-off, change requests) | | ✓ | ✓ |
| Change the payment plan, record client review and sign-off, change requests (`project.edit`) | | ✓ | ✓ |
| Create a payment's invoice (`invoice.manage`) | | ✓ | ✓ |
| Deposit rule, client review days, when the team is paid (`company.manage`) | | | ✓ |

Row-level security: `billing_stages` and `change_requests` are for managers only. Database
guards keep invoiced stages and decided change requests unchanged, and the trigger
`payment_transactions_release` refuses payouts above what the client has paid for (when the
company pays the team in step with the client).

### Messages (Phase 30)

| Action | Team Member | Project Manager | Admin |
|---|:---:|:---:|:---:|
| Start a conversation with active people in the company | ✓ | ✓ | ✓ |
| Read and write in conversations they are in | ✓ | ✓ | ✓ |
| Read anyone else's conversation | | | |

Row-level security: `app_in_conversation()` limits `conversations`, `conversation_members` and
`messages` to the people in each conversation; messages are written only as yourself and never
updated or deleted by the app role.

### Community (Phase 25)

Community roles are separate from company roles: everyone signed in is a Builder; Reviewer is a
badge members choose; Organizers come from `COMMUNITY_ORGANIZER_EMAILS` or are appointed by organizers.

| Action | Visitor | Member | Organizer |
|---|:-:|:-:|:-:|
| See the home page, code of conduct and public profiles | ✓ | ✓ | ✓ |
| See members-only profiles | | ✓ | ✓ |
| Edit own profile; create a company workspace (while sign-up is open) | | ✓ | ✓ |
| Report a profile | | ✓ | ✓ |
| See public projects and their feedback and screenshots | ✓ | ✓ | ✓ |
| See members-only projects | | ✓ | ✓ |
| Share a project (after agreeing to the code of conduct); edit, mark shipped, add screenshots, take down own projects; reply to feedback on them | | ✓ | ✓ |
| Give feedback (not on own projects); report projects and feedback | | ✓ | ✓ |
| See upcoming and past sessions, recordings and notes | ✓ | ✓ | ✓ |
| Join or leave a session (after the code of conduct); see its call link once joined | | ✓ | ✓ |
| Host sessions (with the Reviewer badge); edit, cancel, add recordings to own sessions | | Reviewers | ✓ |
| Cancel any session | | | ✓ |
| See mentors and the tools & prompts library | ✓ | ✓ | ✓ |
| Ask a mentor (2 at a time); answer requests and offer to mentor (Reviewers); end a mentorship you are in | | ✓ | ✓ |
| Share, edit, remove own library items; mark others' useful; report them | | ✓ | ✓ |
| Vote for project of the month (one a month, not your own project) | | ✓ | ✓ |
| Feature library items; pick a finished month's project of the month | | | ✓ |
| See reports; hide or show profiles, projects, feedback, sessions and library items; make or remove organizers | | | ✓ |

Roles are per company (Phase 22): the same person can be an Admin in one company and a Team Member in
another, and no role ever reaches another company's data. An Admin sets a temporary password only for
people who belong to no other company; with email set up (Phase 23) they instead email a password link
to the person's own address, which is safe for anyone.

The GitHub webhook (`/api/github/webhook`) is the one place that writes domain data without a signed-in
person: it verifies GitHub's signature, then acts as the system through the owner connection, only on projects
connected to the event's repository, and records audit events with an empty actor.

## Running the tests

```bash
npm test                                                        # unit tests incl. the full role matrix
DATABASE_URL=postgresql://postgres@localhost:5432/agod_test \
  npm run db:migrate && npm run test:integration                # needs a local, migrated PostgreSQL
```

Integration tests refuse to run unless `DATABASE_URL` points at `localhost`. CI runs both on every pull request.
