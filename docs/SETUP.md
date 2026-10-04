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

## Neon (needs the Neon account owner)

Not configured yet. Steps:

1. Create a Neon project in a region close to Ghana (e.g. AWS `eu-central-1`).
2. Create branches: `production` (default), `staging`, and one `dev-<name>` per developer.
3. For each branch, copy two connection strings:
   - **pooled** (host contains `-pooler`): the app's `DATABASE_URL` on Vercel;
   - **direct**: used only for migrations (`DATABASE_URL_DIRECT`).
4. Enable Neon's point-in-time restore/backups for the production branch (Phase 4 adds the restore runbook).

## Vercel (needs the Vercel account owner)

Not configured yet. Steps:

1. Import the GitHub repository into Vercel (framework: Next.js; no build overrides needed).
2. Set **Production branch** to `main`. Preview deployments then run for every PR, and `integration` gets a stable preview URL used as staging.
3. Environment variables (per Vercel environment; never commit them):

| Variable | Production | Preview / staging |
|---|---|---|
| `DATABASE_URL` | Neon `production` pooled string | Neon `staging` pooled string |
| `BETTER_AUTH_SECRET` | unique random value | different unique random value |
| `BETTER_AUTH_URL` | production URL | staging URL |
| `APP_TIMEZONE` | `Africa/Accra` | `Africa/Accra` |

Do not set `ALLOW_DEV_SEED` or `SEED_PASSWORD` in Vercel.

## GitHub Environments (needs a repo Admin)

Create Environments `staging` and `production` (add required reviewers to `production`), each with secret
`DATABASE_URL_DIRECT` = the direct Neon string for that branch. `.github/workflows/deploy.yml` uses it to apply
migrations: automatically to staging on every push to `integration`, and to production only by a manual run
from `main` that a reviewer approves. Run the production migration before promoting the matching app build.

Branch protection and other repository settings: `docs/GIT_WORKFLOW.md`.
