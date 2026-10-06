# Google Drive (Phase 21)

An Admin connects **one Google account for the team** (for example `agod.team@gmail.com`). The app
then keeps everything in an **AGOD** folder in that account's Drive:

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

## Setup (once per Google Cloud project; then per environment)

### 1. Google Cloud project and APIs

1. Sign in to <https://console.cloud.google.com> with the team Google account (or your own).
2. Create a project, e.g. **AGOD Tracker**.
3. **APIs & Services → Library**: enable **Google Drive API** and **Google Calendar API** (Calendar is
   used by the next update; enabling it now avoids reconnecting later).

### 2. Consent screen (Google Auth Platform)

1. **Google Auth Platform → Branding**: app name *AGOD Tracker*, support email, and your app's domain
   (e.g. `agod-workspace.vercel.app`) under authorised domains.
2. **Audience**: user type **External** (personal Gmail accounts have no "Internal" option).
3. **Data access**: add the scopes `openid`, `.../auth/userinfo.email`, `.../auth/drive.file` and
   `.../auth/calendar`.
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
2. Choose the team Google account, allow access (leave every box ticked).
3. Back on Integrations it says *Connected as …*; *Open the AGOD folder* shows the new folder.

Use a separate team account (or at least a separate *AGOD* folder) for staging and production, so test
data never mixes with real files.

## Good to know

- **People need Google accounts.** Drive only shares with Google accounts. Sharing is done with the email
  each person signs in to the app with; if that address is not a Google account, the Integrations page
  lists it under *Some folders could not be shared*. (The next update lets each person connect their own
  Google account; sharing then uses that.) They can still open every file through the app.
- **Don't delete or move the app's folders** in Drive. If one is deleted (and the trash emptied), the app
  creates it again the next time it needs it, but the old files stay wherever they were.
- **Disconnect** (Integrations) stops new uploads going to Drive and revokes the app's access. Files already
  in Drive stay there; the app can open them again once the **same** account is connected again.
- **Reconnect** if the card shows an error such as *Google no longer accepts the saved sign-in* (the
  password was changed, access was removed in the Google account's security settings, or the app was left
  in *Testing*).
- Size limits are unchanged (4 MB per file, the app's upload limit).
