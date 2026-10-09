# AGOD back office (Phase 40)

The back office at **`/console`** is for AGOD's own staff, who run the platform. It sees across
every company and the community. Decisions: `docs/DECISIONS.md` (Phase 40). Code:
`src/modules/platform`, pages in `src/app/(console)/console`.

## Who can open it

People whose email is in **`PLATFORM_ADMIN_EMAILS`** (comma-separated, set on Vercel), with a
confirmed email and an active login. Changing staff means changing the setting and redeploying;
nobody can make themselves staff from inside the app. Anyone else who opens `/console` gets a plain
"not found". Staff see **Back office** in the sidebar and also count as community organizers.

## What's in it

| Tab | What staff can see and do |
|---|---|
| **Overview** | People, companies, community numbers, open reports, blocked logins, new people per week. **System health**: database, migrations applied, the daily job's last run, email, sign-up, file storage, news sources, the site address and indexing, error monitoring. |
| **Companies** | Every company as a **summary**: name, kind, active people, admins, number of projects, created, last used. A company's page lists its people and roles. **Suspend** a company (its members can't open it; they keep the community and see a notice; no reminders or emails go out) or **restore** it. Nothing is ever deleted. |
| **People** | Every login: search by name, email or profile address; filter blocked or unconfirmed. A person's page shows their companies, community profile and devices signed in. **Block** a login (signs them out everywhere; they can't sign in) or **restore** it; **email a password link** (valid one day). Staff can't block themselves or other staff. |
| **Trust & safety** | Jobs waiting for a check (approve or reject), the risk queue the scam check fills (clear, hide, or ban the author and hide everything they posted). See below. |
| **Moderation** | Open reports (handled on the Reports page), everything organizers have hidden across profiles, projects, feedback, sessions, tools, jobs, team posts, chat, articles, comments and news, and the organizers: make or remove one by profile address. |
| **Content** | Tech news sources (switch off or on, fetch now), the front page photos and video, featured tools & prompts. |
| **Log** | Every back-office action with who did it, when and the reason. It can't be edited. |

## Trust & safety (Phase 41)

The **Trust & safety** tab is where staff catch scams. Code: `src/lib/risk.ts` (the scam check),
`src/modules/safety` (screening, limits, the queue and bans).

**The scam check** reads every job, chat message, article, comment, project, feedback, profile,
tool & prompt and team post when it is saved, and scores it 0 to 100:

| Signal | Examples | Weight |
|---|---|---|
| Asks people to pay | "registration fee", "refundable deposit", "pay to start" | 50 |
| Asks for a PIN, code, password or ID | "MoMo PIN", "OTP", "send your Ghana Card photo" | 50 |
| Investment or quick-money scheme | "double your money", "guaranteed profit", "forex trading", "earn GHS 500 daily" | 40 |
| Moves people off the platform | "WhatsApp me", a Ghana phone number | 15 |
| Pressure to act now | "limited slots", "act now" | 10 |
| Links that hide or fake where they go | shortened links (bit.ly...), bare IP addresses, punycode, look-alikes such as `rnicrosoft.com` or `mtn-momo-bonus.xyz` | 25 to 45 |

Posts by new accounts score 15 more. At **25** a post goes into the **risk queue**; at **40** a job is
**held**: not listed, and its page shows only to the poster ("waiting for a quick check") and
organizers. The check never removes anything by itself. Staff decide:

- **Not a problem**: the flag closes (a held job is approved and listed).
- **Hide it**: with a reason; organizers can show it again on its page.
- **Ban the author**: blocks the login (signed out everywhere) and hides everything they posted:
  profile, jobs, chat, articles, comments, projects, feedback, tools, team posts and sessions.

**New-account limits.** Until someone has confirmed their email and been here **3 days**, they can't
post jobs, share links in the chat or ask mentors (chatting without links is fine). Staff and
organizers are never limited; staff can **lift the limits early** for someone they know, on the
person's page. Every job page also reminds readers never to pay to get a job or share a PIN, code
or Ghana Card photo.

To add a scam phrase or a brand to protect, edit `RULES` or `BRANDS` in `src/lib/risk.ts` (with a
test in `src/lib/risk.test.ts`).

## What staff can't see

A company's projects, tasks, customers, invoices, payouts, files or messages. The console only
counts them. Company data stays private to each company, as before.

## Rules the database keeps

- Suspending and restoring need a reason (5 to 500 characters); every action is in `platform_audit`.
- Only the back office (the server's owner connection) can set or lift a suspension. A company's own
  Admin can't, even through the app's database role (`organizations_suspension_guard`).
- A suspended company drops out of its members' company list (`companiesOf`), so every company page,
  action and API turns them away; the daily job skips it.
