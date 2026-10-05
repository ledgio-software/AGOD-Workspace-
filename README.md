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

- [Decisions](docs/DECISIONS.md) · [Setup](docs/SETUP.md) · [Git workflow](docs/GIT_WORKFLOW.md) · [Pilot](docs/PILOT.md) · [Go-live](docs/GO-LIVE.md) · [Roadmap](docs/ROADMAP.md) · [Frontend contract](docs/FRONTEND_CONTRACT.md)

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
