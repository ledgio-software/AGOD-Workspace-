# Release approvals (Phase 32)

For teams that must show who changed what and who agreed to it, such as fintech teams working for
banks or payment companies. Decisions: `docs/DECISIONS.md` (Phase 32).

## Switching it on

**Company › Release approvals** (Admins). It is on from the start for companies that said they are a
fintech team. Every change of the setting needs a reason and is in the audit log. When it is on,
each project has a **Releases** tab and the menu has **Releases**.

## A release, step by step

1. **Write it** (anyone on the project): name and version, what changes, why, how it was tested,
   how to undo it, and the security impact:
   - *Low*: text, layout, nothing touching money, logins or personal data.
   - *Medium*: business rules or data, but not logins, permissions or payments.
   - *High*: logins, permissions, payments, personal data or secrets.
2. **Submit it.** Managers get a notification. It can't be edited any more; until the security
   check is done the author can take it back to draft.
3. **Security check** (someone on the project other than the author), with a note on what they
   checked. Needed before a high-impact release can be approved.
4. **Approve or reject** (a manager other than the author). Rejecting needs a reason.
5. **Deploy** (someone other than the author) once approved, and record it here.
6. **Roll back** (anyone on the project) if something goes wrong, saying what went wrong.

### Emergency fixes

Tick **Emergency fix** when something is broken for customers now. Once submitted, someone other
than the author can deploy it straight away, writing why it can't wait. Managers are told, and a
manager approves or rejects it afterwards. If it's rejected after going live, roll it back.

### Small teams

If the company allows one person to approve and pay their own work (Company › Two people for money),
the same person may also check, approve and deploy their own release. Turn that off as soon as you
have a second manager.

## Evidence for auditors

**Releases › Evidence for auditors** (Admins): pick the dates and download a CSV with every
release written in them: the details, each step with who did it (name and email) and when, the
notes, and two columns saying whether approval and deployment were done by someone other than the
author. Each download is recorded in the audit log. The audit log itself also has every step.

## How it is enforced

The release service checks every step, and the database checks again (trigger `releases_guard` on
`releases`): the order of steps, no edits after submitting, each step recorded once, not the author,
only managers decide, and the security check first for high-impact releases. Who can see a release
follows who can see its project (row-level security).
