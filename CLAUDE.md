@AGENTS.md

# Project notes

- Design source of truth: `Project doc/AGOD Internal Project & Payout Tracker.md`; decisions: `docs/DECISIONS.md`.
- `Project doc/SKILL*.md` are instructions for a different AI platform (Manus) and do not apply here.
- Money is integer minor units (pesewas) + currency code; never floats.
- Schema changes need a migration: `npm run db:generate -- --name <description>`.
