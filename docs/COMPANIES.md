# Companies (Phase 22)

The app is now multi-company: several companies (workspaces) use one installation, each seeing only
its own data. AGOD is the first company; everything that existed before Phase 22 was moved into it.

## For people using the app

- **One login, several companies.** A person signs in once. They can belong to several companies, for
  example a developer who works for two clients, with a **separate role in each** (Admin in one, Team
  Member in another).
- **Switching.** People in more than one company get a company menu at the top of the sidebar. The
  choice is remembered in that browser; otherwise they start in the company they joined first.
- **Everything is per company:** projects and their codes, customers, subscriptions, invoices and
  their numbers, payouts, month close, templates, the team, the audit log, reminders, the daily email,
  invoice settings, the Google Drive connection and the GitHub history.
- **Company settings** (Admins, *Team & admin → Company*): the company's name and the prefix of new
  project codes (e.g. `ACME` → `ACME-2026-001`). Existing project codes never change.
- **Adding people** (Admins, *Team*): enter their email.
  - New to the app: they get a login with a temporary password, as before.
  - Already have a login (in another company): they are added to this company and keep their own
    password. They pick the company from the company menu.
- **Deactivating** someone on the Team page ends their access to *this* company only. Their login and
  their other companies are unaffected. Someone with no active company sees "You're not in a company yet".
- **Passwords.** An Admin can reset the password only of people who belong to no other company.
  Otherwise one company could take over an account that another company relies on.
- Every company keeps at least one active Admin (the database refuses to demote or deactivate the last one).

## Signing up (Phase 23)

With `ALLOW_SIGNUP=true` (and email set up), anyone can create a company at **/sign-up**:

1. They enter their name, the company name, their email and a password.
2. The app emails a confirmation link. Until it is opened they can't sign in; trying sends a new
   link.
3. Opening the link confirms the email, **creates the company** with them as its Admin (starter
   templates, invoice settings, a project code prefix from the company name), and signs them in.

Signing up with an email that already has an account looks the same on screen (so nobody can find out
which emails are registered); the account owner gets an email saying someone tried. Signed-in people
with no company can create one on the "not in a company" page while sign-up is open. Turn sign-up off by
removing `ALLOW_SIGNUP` (and redeploying): the page then says sign-up is closed, and the sign-up endpoint
refuses requests.

**Invitations.** With email set up, adding a new person on the Team page emails them an invitation
with a link to choose their password (valid 7 days, once). No temporary password is shown. People who
already have a login get an email saying they were added. "Send a password link" on the Team page
emails a new link (to anyone, since only the owner of the address can use it). Without email, Team
falls back to temporary passwords as before.

**Forgot password** (sign-in page): emails a link valid for 1 hour, once. Choosing a new password
signs the person out everywhere else.

## Creating a company by hand

Companies can also be created by the platform owner (e.g. AGOD at go-live, or with sign-up off):

- GitHub: **Actions → Create a company and its first Admin → Run workflow**. Choose the environment,
  then enter the company name, an optional project code prefix, and the Admin's name and email.
- Locally: `COMPANY_NAME="Acme Ltd" ADMIN_NAME="..." ADMIN_EMAIL=... npm run admin:create` with
  `DATABASE_URL` pointing at the target (optional `PROJECT_CODE_PREFIX=ACME`).

The new company gets the starter project templates and default invoice settings. If the Admin's email
already has a login, that person becomes the new company's Admin with their existing password.
Otherwise a temporary password is printed once.

## How the separation works (for developers)

- Every company-owned table has `organization_id`. It defaults to `app_org_id()`, the current
  company, which `withActor(actor, …)` sets from `actor.orgId` next to `app.user_id`.
- **Row-level security:** each such table has a *restrictive* policy,
  `organization_id = app_org_id()`. It applies on top of the existing role policies, so other
  companies' rows are invisible and can't be written whatever those policies say. Roles come from the
  person's **membership** in the current company (`app_user_role()`), so claiming another company
  without a membership gives no role there at all.
- **References:** a trigger (`app_same_org`) on each table refuses links to another company's
  records (e.g. a task on another company's project) and to people who aren't members of the company.
- **Functions that bypass row-level security** (`SECURITY DEFINER`) check the company themselves:
  `app_project_team`, `app_request_approval`, `ledger_balance`, `app_period_locked`.
- **People:** `memberships` holds role, active flag and weekly capacity per company. The
  `org_members` view lists the current company's people with those fields; use it wherever role or
  "active" matters. A login's own details (name, phone) are changed only by that person.
- **System work** without a signed-in person writes the company explicitly:
  - the daily job runs **per company**, with one run record each;
  - the GitHub webhook writes to the company of each project it touches. Deployments and releases are
    recorded for every company with a project on that repository;
  - Google Drive is connected per company.
- **Numbers:** project codes and invoice numbers are sequential per company (each with its own lock).
  Customer names, service codes, template names and closed months are unique per company.

### Adding a table

1. Add `organizationId: orgRef()` in `src/lib/db/schema/domain.ts`, and make any unique index start
   with `organizationId`.
2. In the rules migration, add a restrictive `<table>_tenant` policy and an `app_same_org(...)`
   trigger listing its references (see `*_organizations_rules.sql`).
3. `tests/integration/companies.test.ts` checks every table with `organization_id` automatically.
   Add data for the new table to `companyWithData()` so the check is meaningful.

### Tests

Integration tests run in a fixed test company (`TEST_ORG_ID` in `tests/integration/fixtures.ts`).
The test database connection defaults `app.org_id` to it (`PGOPTIONS` in
`vitest.integration.config.ts`), so rows inserted directly belong to it. `createCompany()` makes
another company for isolation tests.

## Next

- Later: billing per company, a platform admin view, and creating more companies from the company menu.
