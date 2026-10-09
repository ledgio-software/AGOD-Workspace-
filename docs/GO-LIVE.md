# Go-live checklist

Do this only after the pilot sign-off in `docs/PILOT.md`. Steps marked **(you)** need someone with access to
GitHub, Vercel or Neon; nothing here can be done from the repository alone.

## Before

1. **(you)** Repository settings from `docs/GIT_WORKFLOW.md`: branch protection on `main` and `integration`,
   and real usernames in `.github/CODEOWNERS` in place of the placeholders.
2. **(you)** Vercel → Settings → Environment Variables, **Production** scope: `DATABASE_URL` (Neon
   `production` *pooled* string), a new `BETTER_AUTH_SECRET` (not the staging one), `APP_TIMEZONE=Africa/Accra`.
   Optional: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`. Never set `ALLOW_DEV_SEED` or `SEED_PASSWORD`.
3. **(you)** Confirm the GitHub Environment `production` has a required reviewer and its
   `DATABASE_URL_DIRECT` secret is the *direct* Neon `production` string.
4. Confirm CI is green on `integration` and staging has been tested with the commit being released.

## Release

5. Open a pull request `integration → main`, get it approved and merge it.
6. **Actions → Deploy → Run workflow** on branch `main`, target `production`; a reviewer approves it.
   This applies the database migrations. Check the log ends with the migrations applied.
7. Vercel builds `main`. Open the production deployment's build log: it must not contain *Base URL is not
   set* or *You are using the default secret*. If the variables from step 2 were added after the build,
   **Redeploy**.
8. **Actions → Create a company and its first Admin → Run workflow**, target `production`, company `AGOD`,
   prefix `AGOD`. Sign in at
   https://agod-workspace.vercel.app with the printed temporary password and change it on **Account**
   immediately.
9. As that Admin, add the team on **Team**. With email set up they get an invitation email to choose their
   password; otherwise hand each person their temporary password privately.
   To let other companies sign up themselves, add `ALLOW_SIGNUP=true` to Production in Vercel and redeploy
   (needs the SMTP settings; `docs/COMPANIES.md`). Leave it out to keep sign-up closed.

## After

10. Run the restore exercise against production (`docs/RUNBOOK-backup-restore.md`) and log it in
    `docs/SETUP.md`. Schedule the monthly off-Neon backup.
11. On staging, deactivate test and pilot accounts that are no longer needed (**Team → Manage → Deactivate**).
    Records stay; only sign-in is blocked.
12. Enter live projects from this point on. The spreadsheet can be retired once a full payout cycle has run
    in the app without differences.

13. Google (Phase 39): open `https://<your domain>/robots.txt` on production and check it lists
    `Sitemap: https://<your domain>/sitemap.xml` (previews and staging show `Disallow: /`, which is
    right). In [Google Search Console](https://search.google.com/search-console) add the domain,
    verify it (a DNS record), and submit the sitemap under **Sitemaps**. Pages then appear in Google
    over the next days to weeks. To test a link preview, paste a page's address into a WhatsApp chat.

## Rolling back

- App: Vercel → Deployments → the previous production deployment → **Promote to Production**.
- Data: point-in-time restore, `docs/RUNBOOK-backup-restore.md`. Migrations are forward-only; never edit or
  delete an applied one.
