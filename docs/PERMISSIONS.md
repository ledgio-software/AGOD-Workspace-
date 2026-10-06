# How permissions work

Every protected action is checked twice: once in application code, once by PostgreSQL.
A bug in one layer is caught by the other.

| Layer | Where | What it does |
|---|---|---|
| 1. Permission service | `src/lib/permissions` | `can(actor, action, resource)` / `assertCan(...)`: the role rules from the design doc (section 4) and `docs/DECISIONS.md`. Pure function, fully unit-tested. |
| 2. Row-level security | `db/migrations/*_row_level_security.sql` | Domain queries run as the `agod_app` role. Policies decide which rows each user can read or write, using the user's role and active flag from `users`. |
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
   (no `DELETE` for financial data) and policies, in a new migration.
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
