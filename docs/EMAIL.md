# Email reminders (Phase 19)

Once a day (06:00, Africa/Accra = UTC) a scheduled job:

1. creates every active person's reminders — tasks due soon or overdue, approvals waiting, subscription
   renewals — exactly as the app does when they open it;
2. emails each person **one summary** of their unread notifications from the last 7 days that were not
   emailed before. Nothing is sent to people with nothing new. Each notification is emailed at most once;
   if sending fails it is retried the next day.

People turn the email off (or back on) on their **Account** page. Admins see the last runs, can send
themselves a test email and can run the job on demand under **Team & admin → Integrations**.

Without the settings below the app works as before: reminders appear in the app, no email is sent.

## Setup (per environment: staging, then production)

Email goes out over **SMTP** (Nodemailer), so any mailbox that allows SMTP works.

**Gmail / Google Workspace (simplest to start):**

1. Use the mailbox the reminders should come from (e.g. `reminders@yourdomain.com` or a Gmail account).
2. Turn on 2-Step Verification for it, then create an **App password**: Google Account → Security →
   App passwords → name it "AGOD" → copy the 16-character password. (Your normal password won't work.)
3. **Vercel → Project → Settings → Environment Variables**, for the environment you are setting up:
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `587`
   - `SMTP_USER` = the mailbox address
   - `SMTP_PASS` = the app password (mark it *Sensitive*)
   - `EMAIL_FROM` = `AGOD <the same mailbox address>`
   - `CRON_SECRET` = at least 16 random characters (e.g. `openssl rand -hex 24`). Vercel Cron sends it
     automatically to `/api/cron/daily`; without it the endpoint refuses to run.
4. **Redeploy** so the variables take effect.
5. **Check** — Integrations page: the Email card should say *Sending through smtp.gmail.com:587*. Click
   *Send me a test email*, then *Run daily reminders now* and look at *Recent daily runs*.

### If the email says "535-5.7.8 Username and Password not accepted"

Gmail refused the login: `SMTP_PASS` is not a valid **App password** for `SMTP_USER`. Common causes:

- the normal Google password was used (it never works for SMTP);
- the App password was copied with spaces (remove them: 16 letters only) or for another Google account;
- `SMTP_USER` is not the full address (`name@gmail.com`), or differs from the account that made the App
  password;
- 2-Step Verification was turned off (which deletes App passwords), or the password was revoked.

Create a new App password for the same account, paste it into `SMTP_PASS`, **redeploy**, and click *Send
me a test email* on Integrations. Then use *Send a password link* on the Team page for anyone who was
waiting. Until email works, adding a person or sending a password link shows a **temporary password**
for the Admin to pass on instead (Phase 26.2), and people who signed up themselves can't confirm their
email.

Gmail sends up to about 500 emails a day (Google Workspace about 2,000), which is plenty for one summary
per person per day. **Other providers** (Zoho Mail, Microsoft 365, your web host's mail server) work the
same way with their SMTP host, port (587, or 465 with `SMTP_SECURE=true`), username and password. If the
team grows or emails land in spam, a dedicated sending service with SMTP (e.g. Brevo, Mailgun, Amazon SES)
can be swapped in by changing these variables only.

The schedule is in `vercel.json` (`0 6 * * *`). Vercel runs cron jobs for **production** deployments only;
on staging/previews use *Run daily reminders now*.

## Local testing

Set `EMAIL_OUTBOX_DIR=.data/outbox` (and `CRON_SECRET`) in `.env.local`: emails are written there as
JSON files instead of being sent. Trigger the job with
`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily`.
