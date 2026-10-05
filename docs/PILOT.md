# Pilot (Phase 5)

The design doc's Phase 5 exit condition: **the team can explain every amount in the ledger, reproduce every
status transition from the audit trail, and complete a backup/restore exercise.** Until the sign-off at the
bottom is complete, the existing spreadsheet stays the source of truth for payouts.

Run the pilot on **staging** (https://agod-workspace-git-integration-ko2527600s-projects.vercel.app), never
production.

## 1. Load the pilot data

**Actions → Seed pilot data (staging) → Run workflow.** It acts as the first active Admin on staging and runs
the real services, so every amount, status change and audit entry is genuine. Running it again does nothing
once `[Pilot]` projects exist. (Locally: `PILOT_TARGET=local npm run pilot:seed`.)

It creates three members without passwords (`pilot.ama@agod.test`, `pilot.kofi@agod.test`,
`pilot.efua@agod.test`); give one a password with **Team → Manage → Reset password** to see the app as a
member.

| Project | Covers | Expected result |
|---|---|---|
| [Pilot] Northwind Payroll Module: GHS 12,500, percentage 50/30/20 | blocked task, **rejection**, approval, **partial payment**, **increase** | Ama 6,250.00 owed, 3,000.00 paid → *Partially paid*; Kofi 3,750.00 paid → *Paid*; Efua 2,500.00 + 250.00 = 2,750.00 → *Unpaid* |
| [Pilot] AGOD Website Refresh: GHS 4,000, fixed amounts | waived task, **decrease**, unallocated 500.00 | Kofi 2,000.00 → *Paid*; Ama 1,500.00 − 300.00 = 1,200.00 → *Paid* |
| [Pilot] Mobile Money Integration Spike: GHS 8,000 | **blocked** and overdue tasks, not yet approved | no ledger lines; shows on the dashboard as blocked/overdue |

Ledger totals if staging held only pilot data: owed 15,950.00, paid 9,950.00, outstanding 6,000.00.

## 2. Run the real projects

Pick two or three real, recent projects whose payouts are already in the spreadsheet. Enter them as they
happened: team and splits, tasks, approval, then the payments and adjustments already made. Between them they
should include at least one rejection, one partial payment, one blocked task and one adjustment.

## 3. Compare with the spreadsheet

For each check, note anything confusing or wrong in the issues log below.

| Check | Where |
|---|---|
| Recipient amounts | **Reconcile**: paste the spreadsheet (columns `project_code, recipient_email, expected_owed, expected_paid`). Every row should be *Matched*. |
| Each amount explained | **Project → Statement**: split → adjustments with reasons → payments with references → remaining. All checks green. |
| Approval history | Statement timeline and **Audit** filtered by project. |
| Payment balances | **Ledger** and each payout page. |
| Dashboard totals | **Dashboard** owed/paid/outstanding equal the ledger totals. |
| CSV export totals | **Ledger → Export CSV**; sum the columns in a spreadsheet. |
| Every change explained | **Audit**: every status change has a who, when and before/after. |
| Disputes | Ask a question on a payout as a member (**Ask a question** in My work), answer it as a PM, settle one with an adjustment as an Admin (**Questions**). |
| Month close | **Month close** for last month: review the checklist, download the CSV, close the month, then try to record a payment dated in it (refused) and reopen it with a reason. |

## 4. Restore exercise

Follow "Restore exercise" in `docs/RUNBOOK-backup-restore.md` and log it in `docs/SETUP.md`.

## Issues log

| # | Found by | Screen | What happened | Resolution |
|---|---|---|---|---|
| | | | | |

## Sign-off

| Exit condition | Evidence | Signed by (approver) | Signed by (payer) | Date |
|---|---|---|---|---|
| Every ledger amount explained (statements, reconcile all matched) | | | | |
| Every status transition reproduced from the audit trail | | | | |
| Dashboard and CSV totals match the ledger | | | | |
| Backup/restore exercise completed | | | | |

After sign-off, follow `docs/GO-LIVE.md`. Notifications by email, an accounting export and automated payments come
only after this, each as its own project (automated payments need their own security, retry and
reconciliation design).
