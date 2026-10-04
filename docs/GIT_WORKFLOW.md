# AGOD Git Workflow

## Branches
| Branch | Purpose |
|---|---|
| `main` | Production-ready code. PR only. |
| `integration` | Shared frontend + backend branch; staging. PR only. |
| `frontend/AGOD-<id>-<name>` | Frontend task branches |
| `backend/AGOD-<id>-<name>` | Backend task branches |
| `hotfix/AGOD-<id>-<name>` | Urgent production fixes |

No permanent `develop` branch. Feature branches live 1-2 working days.

## Flow
Feature PR -> CI -> preview -> review -> merge to `integration` -> staging -> PM verification -> PR `integration` -> `main` -> production (manual approval gate).

## Daily rules
1. Pull latest `integration`, branch from it, one owner per task, link the issue.
2. Merge `integration` into your branch before opening a PR; keep PRs small.
3. Never commit secrets, `.env`, or build output.
4. Never edit another person's migration; add a corrective one.
5. API contract changes: update shared type/spec first -> backend -> frontend -> integration tests -> describe in PR.
6. Frontend requests schema changes via issue/PR discussion. Migrations are timestamped, e.g. `202610041200_create_projects.sql`, in `backend/supabase/migrations/`. Payout/approval/auth/authz migrations need Admin review before production.

## GitHub settings (must be applied by a repo Admin)
Settings -> Branches (or Rulesets). Not verified as applied.

### `main`
- Require PR; 1 approval; dismiss stale approvals; require up-to-date branch; require conversations resolved
- Required checks: `lint-typecheck-test-build`, `migration-check`
- Block force pushes and deletion; no direct pushes (emergency Admin only)
- Repo Settings -> General: allow squash merge, set as default; disable merge/rebase commits if desired

### `integration`
- Require PR; 1 review (owner of affected area, via CODEOWNERS)
- Required checks: `lint-typecheck-test-build`, `migration-check`
- Block force pushes; no direct pushes

### Environments and secrets
- Environments: `staging`, `production` (add required reviewers to `production`)
- Secrets: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (CI build);
  deployment: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (if Vercel); never service-role keys in PR builds.
- CODEOWNERS: replace `@FRONTEND_GITHUB_USERNAME` / `@BACKEND_GITHUB_USERNAME`.
