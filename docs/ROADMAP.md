# Roadmap status

Source: [`Project doc/AGOD Project, Operations & Payout System - Roadmap.md`](../Project%20doc/AGOD%20Project%2C%20Operations%20%26%20Payout%20System%20-%20Roadmap.md).
Its own rule applies: add a feature when the current process has proven the need. Stage 2 and later start only
after the pilot sign-off in `docs/PILOT.md`.

## Section 2: additions to the current system

| Item | Status | Where |
|---|---|---|
| 2.1 My Work dashboard | Done (Phase 2–4) | My work: summary cards, current projects, my tasks, completed work, my payouts, activity |
| 2.2 Project health | Done: calculated (Phase 2), PM override with reason (Phase 6) | Project page |
| 2.3 Activity timeline and contribution history | Done: project activity, audit log (Phase 1–5); per-person history (Phase 6) | Project page, Audit, Team → person |
| 2.4 In-app notifications | Done: assignment, blocked, returned, approved, payout, payment (Phase 2–4); due soon and overdue (Phase 6) | My work → Notifications |
| 2.5 GitHub integration | Not started (Stage 2). Needs a GitHub App or token for the AGOD organisation and new task states (In review, Ready for QA). | |
| 2.6 Workload and capacity | Partly: per-person open, blocked and overdue counts (Phase 6). A team-wide capacity view with estimates is Stage 2. | Team → person |
| 2.7 Project and task templates | Not started (Stage 2) | |
| 2.8 Dispute and adjustment workflow | Done (Phase 6): member asks → PM reviews → Admin adjusts; original amount stays visible | Payout page, Questions |
| 2.9 Period close | Done (Phase 6): checklist, export, Admin lock and reopen with reason | Month close |

## Stage 1 checklist

All included: secure login; Team Member, PM and Admin roles; projects; assignments; milestones and tasks; My Work;
completion notes; blocked tasks; project progress; project health; approval workflow; immutable compensation
snapshots; payout ledger; partial manual payments; audit trail; dashboard; CSV export.

Still to do before Stage 1 is "in production": the pilot sign-off (`docs/PILOT.md`) and go-live (`docs/GO-LIVE.md`).

## Later stages (not started)

| Stage | Contents | Notes |
|---|---|---|
| 2. Team operations | GitHub issues/PRs and deployments, capacity, templates, comments and mentions, attachments, weekly summaries, reminders, release history | Recommended next: GitHub integration. Attachments need a file storage decision. |
| 3. Profitability | Project costs, margins, revenue by client/type, utilisation, payout forecasting and aging | Needs "other project costs" to be recorded somewhere first. |
| 4. Ledgio integration | Export approved payouts, import payment confirmations, accounting period locking | The month close and CSV exports are the starting point. |
| 5. Automated payments | MoMo/bank APIs, batches, multi-level authorisation, reconciliation | Separate project with its own security and reconciliation design. |
| 6. Portals | Client and contractor access | Only after the internal workflow is stable. |
| 7. Business operating system | CRM to profitability | Long term. |
