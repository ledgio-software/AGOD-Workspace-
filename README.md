# AGOD Internal Project & Payout Tracker

**Organization:** AGOD Software Solutions (AlphaGroupOfDevelopers)  
**Status:** In Development  
**Repository:** https://github.com/ledgio-software/AGOD-Workspace-.git

---

## Overview

An internal web application for managing projects, tracking completion, and calculating contributor payouts for the AGOD development team. This system provides transparent project tracking, approval workflows, and payout ledger management for approximately 10 team members.

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js + TypeScript | Application framework with SSR and API routes |
| UI Components | Tailwind CSS + shadcn/ui | Fast, accessible internal interface |
| Forms | React Hook Form + Zod | Client/server validation |
| Database | PostgreSQL on Neon, Drizzle ORM + migrations | Relational data, transactions, and RLS |
| Authentication | Better Auth (email + password, users stored in our database) | Secure internal login |
| File Storage | To be decided in Phase 4 (optional payment evidence) | Payment evidence and documents |
| Deployment | Vercel + Neon | Minimal operations overhead |
| Monitoring | Sentry | Error tracking and observability |
| Testing | Vitest, Testing Library, Playwright | Unit, integration, and E2E tests |

## Architecture

**Modular Monolith** with clear module boundaries:

- Identity and access control
- Projects and assignments
- Compensation plans and calculations
- Tasks and milestones
- Approval workflows
- Payout ledger
- Manual payment recording
- Audit logging
- Dashboard and reporting

## Core Features

### For Team Members
- View assigned projects and tasks
- Update task status with completion notes
- Track personal work history
- View payout records and payment status
- In-app notifications

### For Project Managers
- Create and manage projects
- Configure team assignments and compensation splits
- Define milestones and tasks
- Approve or reject project completion
- View all project payout records
- Export ledger data

### For Admins
- Manage team members and roles
- Record manual payments
- Create payout adjustments
- View complete audit trail
- Access full system reporting
- Handle edge cases and exceptions

## Key Workflows

### Project Lifecycle
```
DRAFT → PLANNING → IN_PROGRESS → PENDING_APPROVAL → COMPLETED
                                      ↘ REJECTED / CHANGES_REQUESTED
```

### Payout Status (per recipient)
```
NOT_CREATED → OWED → PARTIALLY_PAID → PAID
                         ↘ DISPUTED / VOIDED
```

### Approval Process
1. Team completes assigned tasks
2. Project owner requests approval
3. PM/Admin reviews completion evidence
4. On approval:
   - Immutable compensation snapshot created
   - Payout ledger entries generated
   - Project locked from further edits
5. On rejection:
   - Project returns to IN_PROGRESS with reason
   - Team addresses feedback

## Security

- Server-side authorization enforcement
- PostgreSQL Row Level Security (RLS)
- Audit trail for all material actions
- Encrypted data in transit
- Daily database backups
- Role-based access control
- No automatic money movement (manual payment recording only)

## Money Handling

- All amounts stored as integer minor units (pesewas)
- Currency tracked with ISO codes (default: GHS)
- Deterministic rounding with audit trail
- Split validation before approval
- Transaction-based payment tracking
- Immutable financial snapshots

## Project Structure

```
src/
  app/                    # Next.js pages and routes
    (authenticated)/      # Protected routes
      dashboard/
      projects/
      ledger/
      team/
      my-work/
    api/                  # API routes
  modules/                # Business logic
    auth/
    projects/
    compensation/
    tasks/
    approvals/
    payouts/
    payments/
    audit/
    reporting/
  lib/                    # Shared utilities
    db/
    permissions/
    validation/
    money/
  components/             # UI components
  tests/                  # Test suites
```

## Development Roadmap

### Phase 0 — Decisions & Setup ✓ (see [docs/DECISIONS.md](docs/DECISIONS.md))
- Recorded MVP decisions
- Next.js app shell, Neon/Drizzle migrations, Better Auth sign-in
- Development test users and CI

### Phase 1 — Foundation ✓ (see [docs/PERMISSIONS.md](docs/PERMISSIONS.md))
- Full database schema, permission service and Postgres row-level security
- Audit trail, Team management (Admin), Account page, optional Sentry monitoring

### Phase 2 — Projects & Work Tracking ✓
- Projects with automatic codes, team and compensation splits with a live preview
- Milestones, tasks (done with evidence, blocked with reason, waived), My Work, activity

### Phase 3 — Approval & Ledger ✓
- Request approval, approve (atomic snapshot + payout ledger), return for changes, Admin reopen
- Payout ledger page and personal payout history in My Work

### Phase 4 — Payments & Reporting ✓
- Admin-recorded payments (full or partial) and adjustments; statuses derived by the database
- Dashboard, reports, CSV export, backup/restore runbook ([docs/RUNBOOK-backup-restore.md](docs/RUNBOOK-backup-restore.md))

### Phase 5 — Stabilization (tooling ready; pilot sign-off pending, see [docs/PILOT.md](docs/PILOT.md))
- Project statements with arithmetic checks, audit log viewer, spreadsheet reconciliation
- Staging-only pilot data, pilot plan and sign-off, go-live checklist ([docs/GO-LIVE.md](docs/GO-LIVE.md))

### Phase 6 — Roadmap Stage 1 gaps ✓ (see [docs/ROADMAP.md](docs/ROADMAP.md))
- Project health override with a reason; due-soon and overdue alerts
- Contribution history per person; payout questions (member → PM → Admin adjustment)
- Month close checklist, export and lock

### Phase 7 — Stage 2, part 1 ✓
- Project discussion with @mentions; project templates (starter set, apply, save as template)
- Task estimates, weekly capacity and a workload view; approval reminders; weekly summary

### Phase 8 — GitHub integration ✓ (setup: [docs/GITHUB_APP.md](docs/GITHUB_APP.md))
- Task keys, automatic linking of pull requests and issues, In review / Ready for QA statuses
- Reviews, deployments and releases on the project page; create a GitHub issue from a task

### Phase 9 — File attachments ✓
- Project documents, task files and payment receipts in private Vercel Blob storage, served with access checks

### Phase 10 — Profitability ✓ (backend-first; UI contract: [docs/FRONTEND_CONTRACT.md](docs/FRONTEND_CONTRACT.md))
- Project costs and budgets, estimated vs actual profit and margin, by client and project type
- Payout forecast and aging, team utilisation, profitability CSV export

### Phase 11 — AGOD share ✓
- The company's share per project (default 30%); team splits total the rest, recorded in the approval snapshot

### Phase 12 — Frontend redesign, part 1 ✓
- Design system (indigo, light/dark), sidebar app shell with mobile menu, new sign-in, Dashboard and My Work

### Phase 13 — Frontend redesign, part 2 ✓
- Projects list, project page with tabs (Overview, Tasks, Team & money, Discussion, Files, Activity), new project and statement

### Phase 14 — Frontend redesign, part 3 ✓
- Money pages: Ledger, payout detail, Questions, Month close, Reconcile, and Profitability with charts (profit by type and client, payout forecast, ageing, utilisation)

### Phase 15 — Frontend redesign, part 4 ✓
- Team (with the add/manage panels), contribution history, Workload (load meters), Weekly summary, Audit log, Templates, Integrations and Account; every page now uses the design system

### Phase 16 — Customers and contacts ✓
- Customer records (type, status, account owner, reference, notes) with contacts; external projects link to a customer; archive instead of delete

### Phase 17 — Services and subscriptions ✓
- Service catalogue; customer subscriptions with price, billing, renewal dates and statuses; changes to live terms recorded as amendments; monthly recurring value and renewal-due flags

### Phase 18 — Renewals and recurring revenue ✓
- Renewal reminders for the renewal owner (escalated to Admins after a week), "Record a renewal", renewals on the Dashboard, recurring revenue in Profitability

### Phase 19 — Email reminders ✓
- Daily job (Vercel Cron) creates everyone's reminders and emails one summary per person (SMTP via Nodemailer); opt-out on Account; run history and test email on Integrations (`docs/EMAIL.md`)

### Phase 20 — Invoices ✓
- Draft → issued → paid invoices from subscription periods, project amounts or manual lines; numbered PDFs, sent by email; payments (Admin) and overdue reminders; invoice settings

### Phase 21 — Google Drive ✓
- Admin connects the team Google account; folders per customer and project (shared with the team), uploads and issued invoices saved in Drive, links to Docs/Sheets/Drive files on projects and tasks (`docs/GOOGLE.md`)

### Phase 22 — Companies (multi-tenant foundation) ✓
- Several companies on one installation, each seeing only its own data (enforced by PostgreSQL); one login can belong to several companies with a role in each; company switcher and Company page; per-company project code prefix and invoice numbers (`docs/COMPANIES.md`)

### Phase 23 — Sign-up, invitations and password reset ✓
- Companies sign up themselves (confirmed by email, switch: `ALLOW_SIGNUP`); invitations and password links by email; "Forgot password"; product name Ghana Vibe Coders & Developers (`docs/COMPANIES.md`)

### Phase 24 — Google Calendar ✓
- Company calendar of deadlines shared with managers, personal calendars of each person's tasks, and project meetings with Google Meet links and invitations (`docs/GOOGLE.md`)

### Phase 25 — Community foundation ✓
- Public home page, member list and profiles, code of conduct; join without a company (workspace optional); Builder, Reviewer and Organizer roles; reports and moderation (`docs/COMMUNITY.md`)

### Phase 27 — Teaching sessions ✓
- Reviewers host live sessions (Google Meet, Zoom or Discord link, private to people who join); join with seats, confirmation email with a calendar file, reminders on the day, change and cancellation emails, recordings archive (`docs/COMMUNITY.md`)

### Phase 41 — Trust & safety ✓
- A scam check on everything members post (fee and PIN requests, investment schemes, WhatsApp moves, shortened and look-alike links) that fills a staff risk queue and holds suspicious jobs until checked; new accounts can't post jobs, links in chat or mentor requests for 3 days and until their email is confirmed; staff can ban someone and hide everything they posted in one action (`docs/CONSOLE.md`)

### Phase 40 — AGOD back office ✓
- A console at `/console` for AGOD staff (`PLATFORM_ADMIN_EMAILS`): platform numbers and system health; every company as a summary, with suspend and restore; every login, with block, restore and a password link; all community moderation in one place; news sources, front page and featured tools; and a log of every action with its reason. Company projects and money stay private (`docs/CONSOLE.md`)

### Phase 39 — Search and Google ✓
- One search box for the whole community (members, projects, articles, jobs, sessions, tools & prompts, team finder posts, tech news), grouped by kind and respecting each section's visibility. Public pages are ready for Google: sitemap, robots.txt (production only; previews and staging stay out), titles, descriptions and link previews with a branded picture for WhatsApp, X and LinkedIn (`docs/COMMUNITY.md`)

### Phase 38 — Tech news ✓
- A public news page with headlines on African tech, AI, programming and new releases from free sources (TechCabal, Disrupt Africa, Hacker News, DEV, the GitHub Blog, Hugging Face, TechCrunch and more), refreshed every few hours. Members mark headlines useful for "Top this week"; organizers switch sources off and hide headlines. Also: the public header keeps its links on one line at every screen width (`docs/COMMUNITY.md`)

### Phase 37 — Articles ✓
- Members write articles (headings, lists, code, links, a cover picture, tags, reading time), save drafts and publish; anyone can read them. Readers mark them useful, save them for later, comment and reply, and repost them with a note; Reviewers mark them reviewed. Authors get emails for comments, reviews and reposts (`docs/COMMUNITY.md`)

### Phase 36 — Community chat and feedback conversations ✓
- Discord-style chat for members: channels (#general, #help, #ai-tools, #show-and-tell, #jobs-and-gigs, #off-topic), live updates without reloading, threads, reactions, @tagging, and questions in #help that get marked solved. Feedback on showcase projects becomes a back-and-forth between the author and the reviewer. Also fixed: session call links containing the letter "s" were refused (`docs/COMMUNITY.md`)

### Phase 35 — Front page photos and video ✓
- The community front page shows organizers' photos as a slideshow behind the welcome text, with a welcome video beside it (loads only when tapped); organizers manage both on `/community/front-page`. Showcase project videos now play on the project page, and the share form has a clear "Pictures and video" section (`docs/COMMUNITY.md`)

### Phase 34 — Emojis, stickers, voice notes and tagging in messages ✓
- An emoji picker and emoji reactions, 16 stickers with Ghanaian phrases (Akwaaba, Ayekoo, Medaase, Chale…), voice notes up to 2 minutes recorded in the browser and played only by the people in the conversation, and @-tagging that notifies the person tagged (`docs/DECISIONS.md`)

### Phase 33 — Jobs & gigs and the team finder ✓
- A public board of paid jobs, gigs and internships (pay always shown; no fees from applicants); members apply with a message and their profile, posters shortlist, hire or decline. A team finder where members post ideas that need people or say they want to join a team, and send requests; accepting shares both emails (`docs/COMMUNITY.md`)

### Phase 32 — Release approvals (fintech extras) ✓
- Projects get a Releases tab when the company switches on release approvals (on for fintech teams): each change going live says what changes, why, how it was tested and how to undo it; someone other than the author checks security (needed for high impact), a manager approves, and someone other than the author deploys. Emergency fixes can go live first and be approved afterwards. Admins download the evidence for auditors as a CSV (`docs/RELEASES.md`)

### Phase 31 — Mentors, tools & prompts, project of the month ✓
- Reviewers offer to mentor and members ask with a goal (best matches first: shared tools, same city); a public library of tools, prompts and guides with "useful" marks and featured picks; one vote a month for project of the month, settled when the month ends (`docs/COMMUNITY.md`)

### Phase 30 — Messages ✓
- Private one-to-one and group conversations (up to 10 people) inside a company, a message icon with the unread count (sidebar and phone top bar), "Message" buttons on the Team pages, new messages appearing without reloading, and a daily reminder for messages unread over an hour (in My work and the daily email) (`docs/DECISIONS.md`)

### Phase 29 — Client money flow ✓
- Client projects get a Billing tab: a payment plan (deposit, milestone and final payments; presets like 50/50 and 40/30/30), one invoice per payment with its status, client sign-off with a review deadline in working days, and change requests that add to the project's value once the client approves. Company settings: "no deposit, no work" and paying the team in step with what the client has paid (both also enforced by the database) (`docs/BILLING.md`)

### Phase 28 — Roles, job titles and two people for money ✓
- Each company makes its own roles (copy Team Member, Project Manager or Admin, then switch permission groups off) and its own job titles; "What kind of team are you?" (software, fintech, other) adds suggested titles and roles; nobody approves or pays their own work unless a one-manager company allows it; a password reset also confirms the email (`docs/PERMISSIONS.md`)

### Phase 26.1 — Storage savings ✓
- Pictures made smaller in the browser before upload (WebP, 1600 px), fingerprints so identical screenshots are stored once, and an optional Cloudflare R2 (S3-compatible) storage switch (`docs/STORAGE.md`)

### Phase 26 — Showcase and reviews ✓
- Share projects with a live preview, screenshots and a video demo link; review requests with structured feedback (what works, to improve, next step), author replies, shipped status, give-back counts (`docs/COMMUNITY.md`)

## Getting Started

Full instructions, including Neon, Vercel and environment setup: [docs/SETUP.md](docs/SETUP.md).

```bash
git clone https://github.com/ledgio-software/AGOD-Workspace-.git
cd AGOD-Workspace-
npm ci
cp .env.example .env.local   # fill in DATABASE_URL, BETTER_AUTH_SECRET, ...
npm run db:migrate           # apply migrations
npm run db:seed              # development only: creates test users
npm run dev                  # http://localhost:3000
```

## Documentation

- [Decisions](docs/DECISIONS.md) · [Setup](docs/SETUP.md) · [Git workflow](docs/GIT_WORKFLOW.md) · [Pilot](docs/PILOT.md) · [Go-live](docs/GO-LIVE.md) · [Roadmap](docs/ROADMAP.md) · [Frontend contract](docs/FRONTEND_CONTRACT.md) · [Email](docs/EMAIL.md) · [Google Drive and Calendar](docs/GOOGLE.md) · [Companies and sign-up](docs/COMPANIES.md) · [Community](docs/COMMUNITY.md) · [File storage](docs/STORAGE.md)

Detailed design documentation in the `Project doc/` folder:
- [Full System Design](Project%20doc/AGOD%20Internal%20Project%20%26%20Payout%20Tracker.md)
- [Technical Specifications](Project%20doc/AGOD_Project_Payout_Tracker_System_Design_Advanced.pdf)

## Testing

```bash
npm test             # unit tests (Vitest)
npm run type-check   # TypeScript
npm run lint         # ESLint
npm run build        # production build
```

## Contributing

This is an internal AGOD project. All team members should:
1. Branch from `integration` (`frontend/AGOD-<id>-<name>` or `backend/AGOD-<id>-<name>`) — see [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)
2. Follow the established code style
3. Write tests for new features
4. Submit PRs for review
5. Ensure CI checks pass

## License

Internal use only - AGOD Software Solutions

---

**For questions or support, contact the AGOD Admin team.**
