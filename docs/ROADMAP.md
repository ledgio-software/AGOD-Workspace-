# Roadmap status

Source: [`Project doc/AGOD Project, Operations & Payout System - Roadmap.md`](../Project%20doc/AGOD%20Project%2C%20Operations%20%26%20Payout%20System%20-%20Roadmap.md).
Its own rule applies: add a feature when the current process has proven the need. The roadmap recommends starting
Stage 2 after the pilot sign-off in `docs/PILOT.md`; AGOD chose to start it in parallel with the pilot (2026-10-05).

## Section 2: additions to the current system

| Item | Status | Where |
|---|---|---|
| 2.1 My Work dashboard | Done (Phase 2–4) | My work: summary cards, current projects, my tasks, completed work, my payouts, activity |
| 2.2 Project health | Done: calculated (Phase 2), PM override with reason (Phase 6) | Project page |
| 2.3 Activity timeline and contribution history | Done: project activity, audit log (Phase 1–5); per-person history (Phase 6) | Project page, Audit, Team → person |
| 2.4 In-app notifications | Done: assignment, blocked, returned, approved, payout, payment (Phase 2–4); due soon and overdue (Phase 6) | My work → Notifications |
| 2.5 GitHub integration | Done (Phase 8): task keys, automatic PR/issue linking, In review / Ready for QA, reviews, deployments and releases, create issue from a task. Needs the GitHub App set up (`docs/GITHUB_APP.md`). | Project page, Team → GitHub integration |
| 2.6 Workload and capacity | Done: per-person counts (Phase 6); estimates, weekly capacity and team load view (Phase 7) | Workload, Team → person |
| 2.7 Project and task templates | Done (Phase 7): starter templates, apply to a project, save a project as a template | Projects → Templates, project page |
| 2.8 Dispute and adjustment workflow | Done (Phase 6): member asks → PM reviews → Admin adjusts; original amount stays visible | Payout page, Questions |
| 2.9 Period close | Done (Phase 6): checklist, export, Admin lock and reopen with reason | Month close |

## Stage 1 checklist

All included: secure login; Team Member, PM and Admin roles; projects; assignments; milestones and tasks; My Work;
completion notes; blocked tasks; project progress; project health; approval workflow; immutable compensation
snapshots; payout ledger; partial manual payments; audit trail; dashboard; CSV export.

Still to do before Stage 1 is "in production": the pilot sign-off (`docs/PILOT.md`) and go-live (`docs/GO-LIVE.md`).

## Later stages

| Stage | Contents | Notes |
|---|---|---|
| 2. Team operations | **Done (Phases 6–9):** comments and mentions, templates, workload and capacity, approval reminders, overdue alerts, weekly summary, contribution history, GitHub issues/PRs/reviews, deployment and release history, file attachments (incl. payment receipts, also section 14). Notifications are in-app, plus a daily email summary since Phase 19 (`docs/EMAIL.md`). | |
| 3. Profitability | **Done (Phase 10, backend-first):** project costs and cost budgets, estimated vs actual profit and margin, revenue and profit by client and by project type, payout forecast and aging, utilisation, CSV export. | Pages are plain tables until the frontend redesign (`docs/FRONTEND_CONTRACT.md`). |
| Customers | **Done (Phases 16–18):** customer records with contacts, projects linked to customers; service catalogue and subscriptions with amendments, monthly recurring value and renewal-due flags. Renewal reminders, recorded renewals, renewals on the Dashboard and recurring revenue in Profitability (Phase 18). Daily email summaries (Phase 19). Invoices with PDFs, email, payments and overdue reminders (Phase 20). Google Drive folders, uploads, links and invoice copies (Phase 21, `docs/GOOGLE.md`). Google Calendar: company deadlines calendar, personal task calendars and project meetings with Google Meet (Phase 24). | Customers, Subscriptions, Services, Profitability |
| Platform | **Done (Phases 22–23):** several companies on one installation, each fully separate (database-enforced), people in several companies with a role in each, per-company project and invoice numbering; self sign-up confirmed by email, invitations and password reset by email (`docs/COMPANIES.md`). Next: billing. | Company switcher, Company page |
| 4. Accounting integration | Export approved payouts, import payment confirmations, accounting period locking | The month close and CSV exports are the starting point. |
| 5. Automated payments | MoMo/bank APIs, batches, multi-level authorisation, reconciliation | Separate project with its own security and reconciliation design. |
| 6. Portals | Client and contractor access | Only after the internal workflow is stable. |
| 7. Business operating system | CRM to profitability | Long term. |

## Community (Phase 25 onwards)

The product is also a community for people in Ghana who build software (`docs/COMMUNITY.md`).
Done: member sign-up without a company, profiles and member list, roles, code of conduct, reports
(Phase 25); showcase with screenshots and video demo links, review requests and feedback (Phase 26).
Teaching sessions with join, calendar files, reminders and a recordings archive (Phase 27).
Mentorship matching, the tools & prompts library and project of the month (Phase 31).
Jobs & gigs board and the team finder (Phase 33).
Later: badges, events calendar, partners page and community numbers.

## Company workflow (Phase 28 onwards)

From the workflow research (software and fintech teams, October 2026). Done: company-made roles,
job titles, "what kind of team are you?" set-up, two people for money (Phase 28); client money
flow: payment plans, deposit rule, client sign-off, change requests, paying the team in step with
the client (Phase 29); in-app messages with an unread icon (Phase 30); release approvals with a security
check, an emergency path and evidence export for auditors (Phase 32). Later: tax rates as settings
(withholding tax on client payments), and a client portal for online sign-off.
