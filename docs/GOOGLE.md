# Google Drive and Calendar (Phases 21 and 24)

An Admin connects **one Google account for the team** (for example `agod.team@gmail.com`). The app
then keeps everything in a folder named after the company (**AGOD** here) in that account's Drive. Each
company (Phase 22, `docs/COMPANIES.md`) connects its own Google account:

```
AGOD/                              shared (Editor) with every active PM and Admin
  <Customer>/
    Invoices/                      PDF of every issued invoice
    AGOD-2026-001 <Project>/       shared (Editor) with the project's team members
  Internal projects/
    AGOD-2026-002 <Project>/
  Payment receipts/                payout receipts (managers only)
```

- **Uploads** (project documents, task files, payment receipts) are saved in the project's folder, or in
  *Payment receipts*. People still open them from the app, which checks who may see them; members also
  see their projects' folders in Drive under *Shared with me*.
- **Issued invoices** are saved as PDFs in the customer's *Invoices* folder (button *Save to Drive* on the
  invoice if that failed).
- **Links**: anyone who can add files can also paste links to Google Docs, Sheets, Slides or Drive files
  on a project (Files tab) or on their task.
- **Sharing** is kept up to date every morning (with the daily reminders) and on *Sync now*: managers on
  AGOD, each live project's team on its folder. Access the app gave is removed when someone leaves a
  project or stops being a manager; anything you share by hand in Drive is left alone.
- The app uses the `drive.file` permission: it can only see and change the files and folders **it
  created**, never the rest of that Drive.

Without Google set up, or before an Admin connects an account, everything works as before (files in
Vercel Blob). Files saved earlier stay where they are.

## Calendar (Phase 24)

- **Company calendar.** Connecting the company account (with the Calendar box ticked) creates a calendar
  named *<Company>: projects and deadlines* in that account. It shows live projects' target dates,
  open milestones, open tasks with due dates (with who they're assigned to), renewals of active and
  paused subscriptions, and due dates of unpaid issued invoices, from a month ago to a year ahead.
  Each event links back to the app. It is shared **view only with active PMs and Admins** (Team Members
  don't see other people's projects). *Open the calendar* on Integrations opens it.
- **Personal calendars.** Anyone can connect their own Google account on their **Account** page
  (*Connect my Google Calendar*). The app creates *<Company>: my tasks* there with their own open tasks
  that have due dates. It uses the `calendar.app.created` permission: it can only see and change the
  calendar it created, never the rest of their calendar. People who connected are also invited and
  shared with at that Google address instead of their sign-in email.
- **Project meetings.** On a project's Overview, PMs and Admins use *Schedule a meeting* (title, date,
  start time in Accra time, length, agenda). The meeting goes in the company calendar with a **Google
  Meet** link, and Google emails the invitation to the project owner, the assigned team and everyone
  with a task on the project. Everyone on the project sees it with a *Join with Google Meet* link.
  *Cancel* removes it and Google tells the guests. Meetings can't be edited: cancel and schedule again.
- **Keeping up to date.** Every morning (with the reminders), on *Sync Drive and Calendar now*
  (Integrations) and on *Sync now* (Account). The app only adds, changes and removes the events it
  made. A calendar deleted in Google is created again on the next sync.

## Setup (once per Google Cloud project; then per environment)

### 1. Google Cloud project and APIs

1. Sign in to <https://console.cloud.google.com> with the team Google account (or your own).
2. Create a project, e.g. **AGOD Tracker**.
3. **APIs & Services → Library**: enable **Google Drive API** and **Google Calendar API**.

### 2. Consent screen (Google Auth Platform)

1. **Google Auth Platform → Branding**: app name *AGOD Tracker*, support email, and your app's domain
   (e.g. `agod-workspace.vercel.app`) under authorised domains.
2. **Audience**: user type **External** (personal Gmail accounts have no "Internal" option).
3. **Data access**: add the scopes `openid`, `.../auth/userinfo.email`, `.../auth/drive.file`,
   `.../auth/calendar` (the company account) and `.../auth/calendar.app.created` (personal calendars).
   If you set the consent screen up for Phase 21 already, add `calendar.app.created` now.
4. **Audience → Publish app** (status *In production*). Important: while the app is in *Testing*, Google
   ends the connection after **7 days** and you would have to reconnect every week.

Google does not need to verify the app for a team this size. When connecting, Google shows *"Google
hasn't verified this app"*: choose **Advanced → Go to AGOD Tracker (unsafe)**. This is expected for an
internal tool you created yourself.

### 3. OAuth client

1. **Google Auth Platform → Clients → Create client**, type **Web application**, name *AGOD Tracker*.
2. **Authorised redirect URIs** — one per environment (the Integrations page shows the exact one):
   - `https://agod-workspace.vercel.app/api/google/callback` (production)
   - `https://agod-workspace-git-integration-ko2527600s-projects.vercel.app/api/google/callback` (staging)
   - `http://localhost:3000/api/google/callback` (local, optional)
3. Copy the **Client ID** and **Client secret**.

### 4. Vercel

**Project → Settings → Environment Variables**, for each environment (Production, and Preview →
`integration`):

| Variable | Value | Sensitive |
|---|---|---|
| `GOOGLE_CLIENT_ID` | the client ID | no |
| `GOOGLE_CLIENT_SECRET` | the client secret | yes |

Redeploy so they take effect. The connection's sign-in is stored encrypted with `BETTER_AUTH_SECRET`;
changing that secret means connecting Google again.

### 5. Connect

1. Sign in to the app as an **Admin** → **Team & admin → Integrations → Google Drive → Connect Google**.
2. Choose the team Google account, allow access (leave every box ticked, including Calendar).
   An account connected before Phase 24 already allowed Calendar; the company calendar appears with the
   next morning's sync or *Sync Drive and Calendar now*.
3. Back on Integrations it says *Connected as …*; *Open the AGOD folder* shows the new folder.

Use a separate team account (or at least a separate *AGOD* folder) for staging and production, so test
data never mixes with real files.

## Good to know

- **People need Google accounts.** Drive only shares with Google accounts. Sharing is done with the email
  each person signs in to the app with; if that address is not a Google account, the Integrations page
  lists it under *Some folders could not be shared*. The company calendar is shared with a manager's own
  Google account once they connect it on their Account page. They can still open every file through the app.
- **Don't delete or move the app's folders** in Drive. If one is deleted (and the trash emptied), the app
  creates it again the next time it needs it, but the old files stay wherever they were.
- **Disconnect** (Integrations) stops new uploads going to Drive and revokes the app's access. Files already
  in Drive stay there; the app can open them again once the **same** account is connected again.
- **Reconnect** if the card shows an error such as *Google no longer accepts the saved sign-in* (the
  password was changed, access was removed in the Google account's security settings, or the app was left
  in *Testing*).
- Size limits are unchanged (4 MB per file, the app's upload limit).
