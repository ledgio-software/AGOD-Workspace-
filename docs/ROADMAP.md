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
| 2. Team operations | **Done (Phases 6–9):** comments and mentions, templates, workload and capacity, approval reminders, overdue alerts, weekly summary, contribution history, GitHub issues/PRs/reviews, deployment and release history, file attachments (incl. payment receipts, also section 14). Notifications are in-app only; email, Slack or WhatsApp would need a scheduled job and a provider. | |
| 3. Profitability | **Done (Phase 10, backend-first):** project costs and cost budgets, estimated vs actual profit and margin, revenue and profit by client and by project type, payout forecast and aging, utilisation, CSV export. | Pages are plain tables until the frontend redesign (`docs/FRONTEND_CONTRACT.md`). |
| Customers | **Done (Phases 16–17):** customer records with contacts, projects linked to customers; service catalogue and subscriptions with amendments, monthly recurring value and renewal-due flags. Next: renewal reminders (daily job), renewals dashboard, subscription income in Profitability. | Customers, Subscriptions, Services |
| 4. Accounting integration | Export approved payouts, import payment confirmations, accounting period locking | The month close and CSV exports are the starting point. |
| 5. Automated payments | MoMo/bank APIs, batches, multi-level authorisation, reconciliation | Separate project with its own security and reconciliation design. |
| 6. Portals | Client and contractor access | Only after the internal workflow is stable. |
| 7. Business operating system | CRM to profitability | Long term. |
