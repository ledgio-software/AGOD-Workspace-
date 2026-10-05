# Setup

## Local development

Requirements: Node.js 22+, npm, and a PostgreSQL database (a Neon development branch, or local PostgreSQL 16).

```bash
npm ci
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **development** branch connection string, or `postgresql://postgres:postgres@localhost:5432/agod` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://localhost:3000` |
| `APP_TIMEZONE` | `Africa/Accra` |
| `ALLOW_DEV_SEED` / `SEED_PASSWORD` | `true` / a password of 10+ characters for the test accounts |

```bash
npm run db:migrate   # apply migrations
npm run db:seed      # create admin@agod.test, pm@agod.test, member@agod.test
npm run dev          # http://localhost:3000, sign in with a test account
```

The seed refuses to run unless `ALLOW_DEV_SEED=true`, and never with `NODE_ENV=production`.

## Changing the schema

1. Edit the Drizzle schema in `src/lib/db/schema/`.
2. `npm run db:generate -- --name <what_changed>` creates a timestamped SQL file in `db/migrations/`.
3. Review the SQL, then `npm run db:migrate`.
4. Commit the schema change and the migration together. CI fails if the schema changes without a migration.

Never edit a migration that has been applied to staging or production. Add a corrective migration.

## Neon

Configured on 2026-10-04: project **AGOD Workspace** (AWS `us-east-2`) with branches `production` (default),
`staging`, `anthony dav-1` and `kingsley dav-2`.

Each branch has two connection strings (Neon → **Connect**, choose the branch):

- **pooled** (Connection pooling **on**, host contains `-pooler`): the app's `DATABASE_URL` (Vercel, `.env.local`);
- **direct** (pooling **off**): migrations only (`DATABASE_URL_DIRECT` in GitHub Environments).

Copy strings straight from Neon into their destination. Never paste them into chat, issues or docs. If one leaks,
use **Reset password** for that branch's role and update every place that uses it.

Do not enable Neon's own "Better Auth" feature: the app runs Better Auth itself with its own tables.

## Vercel

Configured on 2026-10-04: project **agod-workspace**, production branch `main`.

| | URL |
|---|---|
| Staging (`integration` branch) | https://agod-workspace-git-integration-ko2527600s-projects.vercel.app |
| Production (`main`) | https://agod-workspace.vercel.app |

Settings that must stay as they are:

- **Settings → Build and Deployment → Framework Preset: Next.js**, with no overrides. ("Other" fails with
  *No Output Directory named "public"*.)
- Environment variables are scoped per environment **and** branch. Staging values: **Preview → branch `integration`**.

| Variable | Production | Preview → `integration` | Sensitive |
|---|---|---|---|
| `DATABASE_URL` | Neon `production` pooled string | Neon `staging` pooled string | yes |
| `BETTER_AUTH_SECRET` | unique random value | different unique random value | yes |
| `APP_TIMEZONE` | `Africa/Accra` | `Africa/Accra` | no |
| `BETTER_AUTH_URL` | optional (defaults to the production domain) | optional (defaults to the branch URL) | no |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | optional, enables error monitoring | optional | no |
| `BLOB_READ_WRITE_TOKEN` | added by connecting a Blob store (below) | same store or a separate one | yes |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | optional, the production GitHub App (`docs/GITHUB_APP.md`) | optional, the staging GitHub App | key and secret: yes |

Generate a secret in PowerShell:
`$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`
(macOS/Linux: `openssl rand -base64 32`).

**Variables only apply to builds made after they are saved.** After changing one, open the latest deployment of
that branch and use **⋯ → Redeploy**. Check the build log: it must not contain *Base URL is not set* or
*You are using the default secret*. A deployment showing a bare "Internal Server Error" usually means a missing
variable; the runtime log names it.

Pull-request previews (branches other than `integration`) get no database settings, so they build but do not
run. Test on staging after merging into `integration`.

Do not set `ALLOW_DEV_SEED` or `SEED_PASSWORD` in Vercel.

## File storage (Vercel Blob)

Attachments (project documents, task files, payment receipts) are stored in a **private** Vercel Blob store and
only ever served through the app, which checks who may see each file. Until a store is connected, the upload
buttons say uploads are not set up; everything else works.

1. Vercel → project **agod-workspace** → **Storage** → **Create Database** → **Blob** → name it `agod-files`.
2. Choose **Private** access if asked, and connect it to the project for the environments that should have
   uploads (Preview and/or Production). Vercel adds `BLOB_READ_WRITE_TOKEN` automatically.
3. Redeploy the branch (Deployments → ⋯ → Redeploy).

Files can be at most 4 MB (Vercel's request limit is 4.5 MB). Allowed: PDF, PNG, JPEG, GIF, WebP, TXT, CSV,
Markdown, DOCX, XLSX, PPTX and ZIP; the content must match the extension.

## GitHub Environments

Configured on 2026-10-04: Environments `staging` and `production` (required reviewer, deployments only from
`main`), each with secret `DATABASE_URL_DIRECT` = the **direct** Neon string for that branch.

- `.github/workflows/deploy.yml` applies migrations: automatically to staging on every push to `integration`;
  to production only by a manual run from `main` that a reviewer approves. Run the production migration before
  promoting the matching app build.
- `.github/workflows/create-admin.yml` creates the first Admin of an environment (see below).

Branch protection and other repository settings: `docs/GIT_WORKFLOW.md`.

## Creating the first Admin

An environment with no Admin (e.g. production at go-live) needs one created outside the app. After that,
Admins add and manage everyone on the **Team** page.

- From GitHub: **Actions → Create first Admin → Run workflow**, choose the environment, enter name and email.
- Locally: `ADMIN_NAME="..." ADMIN_EMAIL=... npm run admin:create` with `DATABASE_URL` pointing at the target.

Both refuse if an active Admin already exists. The temporary password is printed once (in the workflow log,
which repo collaborators can read), so sign in and change it on the **Account** page immediately.

## Restore exercises

Backups and restore steps: `docs/RUNBOOK-backup-restore.md`. Record each exercise here.

| Date | Who | Environment | Result |
|---|---|---|---|
| | | | |
