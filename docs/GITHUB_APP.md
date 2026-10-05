# GitHub integration setup

The tracker connects to GitHub through a **GitHub App** owned by the `ledgio-software` organisation
(decision, Phase 8). With it:

- every task has a key such as `AGOD-2026-005-T3`. Any pull request or issue in the project's repository
  that mentions the key, in the branch name, title or description, is linked to the task automatically;
- a pull request moves its task automatically:
  - draft opened → **In progress**;
  - opened for review → **In review**;
  - merged → **Ready for QA**, and the project owner is asked to verify;
  - closed without merging → back to **In progress**.

  The PM marks the task **Done** after checking it on staging. Done and Waived tasks are never changed automatically;
- reviews are recorded on the pull request link, and "changes requested" notifies the assignee;
- deployments and releases of the repository show on the project page under **Delivery**;
- PMs can **create a GitHub issue** for a task, and anyone working on a task can paste a GitHub link to it.

Each GitHub App has one webhook URL, so make **one app per environment**: "AGOD Tracker (staging)" now,
and "AGOD Tracker" for production at go-live (`docs/GO-LIVE.md`). The steps are the same.

## 1. Let GitHub reach staging (Vercel)

Staging is a Vercel preview deployment. Previews normally require a Vercel login, which GitHub doesn't have.

1. Vercel → project **agod-workspace** → **Settings → Deployment Protection**.
2. Under **Protection Bypass for Automation**, click **Add Secret** and copy the generated value.
3. Your webhook URL is the staging URL with the secret as a query parameter:
   `https://agod-workspace-git-integration-ko2527600s-projects.vercel.app/api/github/webhook?x-vercel-protection-bypass=<secret>`

Production (`agod-workspace.vercel.app`) is not protected by default and needs no bypass.

## 2. Create the GitHub App

1. GitHub → **ledgio-software** organisation → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. **GitHub App name**: `AGOD Tracker (staging)`. **Homepage URL**: the staging URL.
3. **Webhook**:
   - Active: on.
   - **Webhook URL**: the URL from step 1.
   - **Webhook secret**: a new random value. On macOS or Linux run `openssl rand -hex 32`; in PowerShell run
     `-join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })`. Keep it for step 4.
4. **Repository permissions**:
   - Issues: **Read and write** (to create issues for tasks);
   - Pull requests: **Read-only**;
   - Deployments: **Read-only**;
   - Contents: **Read-only** (for releases);
   - Metadata: **Read-only** (always required).
5. **Subscribe to events**: Issues, Pull request, Pull request review, Deployment status, Release.
6. **Where can this GitHub App be installed?**: Only on this account. Click **Create GitHub App**.
7. Note the **App ID** at the top of the app page.
8. Under **Private keys**, click **Generate a private key**. A `.pem` file downloads; keep it safe, it is a password.

## 3. Install the app

On the app page: **Install App** → `ledgio-software` → **Only select repositories** → choose the repositories AGOD
projects use → **Install**.

## 4. Add the settings to Vercel

Vercel → **Settings → Environment Variables**, scope **Preview → branch `integration`**:

| Variable | Value | Sensitive |
|---|---|---|
| `GITHUB_APP_ID` | the App ID | no |
| `GITHUB_APP_PRIVATE_KEY` | the whole contents of the `.pem` file, including the BEGIN/END lines | yes |
| `GITHUB_WEBHOOK_SECRET` | the webhook secret from step 2 | yes |

Then **Deployments** → latest `integration` deployment → **⋯ → Redeploy** (variables only apply to new builds).

## 5. Check it works

1. In the tracker as an Admin: **Team → GitHub integration**. It should say *Connected as the GitHub App "AGOD Tracker (staging)"*.
2. GitHub → the app → **Advanced → Recent Deliveries**: the `ping` delivery should show **200**. If it shows 401
   from Vercel, the bypass secret in the URL is wrong. If it shows 401 from the app, the webhook secret doesn't
   match `GITHUB_WEBHOOK_SECRET`. A 503 means the variables are missing or staging wasn't redeployed.
3. On a project page: **Connect a GitHub repository** → `ledgio-software/<repo>`.
4. Open a pull request whose branch contains a task's key (each task shows its key and a suggested branch name).
   The task moves to **In review** and the pull request appears under it.

## Security notes

- The webhook endpoint accepts only requests signed with the webhook secret. Each delivery is processed once.
- Only projects connected to the event's repository are touched, so a pull request in another repository can't
  move AGOD tasks.
- The webhook acts as the system: its changes show as "System" in the activity and audit log, with the pull
  request in the reason.
- To revoke access: uninstall the app from the organisation, or delete the private key on the app page.
