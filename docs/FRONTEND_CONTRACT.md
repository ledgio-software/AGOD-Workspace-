# Frontend contract

The pages under `src/app/(authenticated)` are deliberately plain: they read data from server-side services and
submit server actions. A redesign can replace any page's markup freely as long as it keeps to the rules below and
uses the same services and actions. Everything the business depends on (permissions, row-level security, money
rules, audit) lives behind these functions, not in the pages.

## Rules for the redesign

1. **Pages are Server Components.** Get the signed-in person with `requireUser()` (`@/lib/session`), then call
   the services directly. Never query the database from a page or component.
2. **Hide, don't gate.** Use `can(actor, "<action>")` (`@/lib/permissions`) only to decide what to show. The services
   check permissions again and the database checks them a third time.
3. **Writes go through server actions.** Each action in `*/actions.ts` validates its form fields with Zod and
   returns `{ ok, message, fieldErrors }` (`runAction`). `ActionForm` in `src/components/form.tsx` handles pending
   state, errors and the success message; a custom form must show `fieldErrors` next to the fields.
4. **Form field names are the contract.** Keep the `name` attributes the current forms use (the action's Zod input
   in the module, e.g. `costInput` in `@/modules/finance`). Hidden inputs carry ids and `expectedVersion`.
5. **Money:** services return integer minor units (`...Minor`). Display with `formatMoney` (`@/lib/money`); forms
   send amounts as decimal strings ("1250.50"). Never do money arithmetic in the UI.
6. **Labels:** use the label helpers in `@/lib/labels` for statuses, categories and audit events.
7. **Dates** are `YYYY-MM-DD` strings in the operating time zone (`@/lib/dates`).
8. **Files** are only ever linked as `/files/<id>`; uploads use the existing upload actions (4 MB limit).

## Pages, data and actions

| Page | Shown to | Reads | Writes (server actions) |
|---|---|---|---|
| `/dashboard` | everyone | `getDashboard`, `getMyWork`, `questionsWaitingOn` | |
| `/my-work` | everyone | `getMyWork` (tasks, payouts, notifications) | `my-work/actions`: `markNotificationsReadAction`; task progress uses `projects/actions` |
| `/projects` | everyone (own projects for members) | `listProjects` | |
| `/projects/new` | `project.create` | `listActiveMembers` | `createProjectAction` |
| `/projects/[id]` | anyone who can see the project | `getProjectWorkspace`, `getProjectPayouts`, `listComments`, `listProjectAttachments`, `getProjectGithub`, `getProjectFinance` (`finance.view`), `listTemplates` | `projects/actions`: project edit/status/health, team (`addAssignmentAction`, ...), milestones, tasks, approvals, comments, GitHub, files, finance (`projectFinanceAction`, `recordCostAction`, `voidCostAction`) |
| `/projects/[id]/statement` | anyone who can see the project | `getProjectStatement` | |
| `/payouts/[id]` | the payee, managers | `getPayout`, `questionsForPayout`, `listPaymentReceipts` | `payouts/actions`: payments, adjustments, questions, receipts |
| `/ledger` (+ `/ledger/export`) | `payout.viewAll` | `listLedger` | |
| `/questions` | `payoutQuestion.review` | `listQuestions` | `payouts/actions` (review, resolve) |
| `/close` (+ `/close/export`) | `period.view` | `getPeriodClose`, `periodMovements` | `close/actions`: `closePeriodAction`, `reopenPeriodAction` (`period.close`) |
| `/reconcile` | `payout.viewAll` | | `reconcile/actions`: `reconcileAction` |
| `/profitability` (+ `/profitability/export`) | `finance.view` | `getProfitability({ scope, category })`, `getPayoutForecast`, `getPayoutAging`, `getUtilisation(month)` | |
| `/team`, `/team/[id]` | `team.view` | `listTeam`, `getContributionHistory` | `team/actions` (`team.manage`) |
| `/workload` | `workload.view` | `getWorkload` | |
| `/summary` | `report.weekly` | `getWeeklySummary`, `summaryText` | |
| `/templates`, `/templates/[id]` | `template.manage` | `listTemplates`, `getTemplate` | `templates/actions` |
| `/audit` | `audit.viewProject` | `listAuditEvents` | |
| `/integrations` | Admins (`audit.viewAll`) | `isGithubConfigured`, `recentDeliveries` | |
| `/account` | everyone | session | Better Auth (change password, sign out) |

## Profitability data (Phase 10)

`getProfitability(actor, { scope: "all" | "active" | "completed", category? })` returns:

- `projects[]`: one row per project (name, client, category, status) with the financials below;
- `totals`, `byClient[]`, `byCategory[]`: `{ name, projects, revenueMinor, payoutMinor, costMinor, profitMinor, marginPct }`.

Project financials (also returned by `getProjectFinance(actor, projectId).financials`):

| Field | Meaning |
|---|---|
| `revenueMinor` | Project value (0 for internal projects) |
| `plannedPayoutMinor` | Payouts from the current compensation plan |
| `committedPayoutMinor`, `paidPayoutMinor`, `outstandingPayoutMinor` | From the ledger after approval |
| `costBudgetMinor`, `actualCostMinor`, `costOverBudgetMinor` | Budgeted, recorded (non-voided) and over-budget costs |
| `estimatedProfitMinor`, `estimatedMarginPct` | Revenue − planned payouts − cost budget |
| `actualProfitMinor`, `actualMarginPct` | Revenue − payouts (committed once approved) − recorded costs; margins are percentages to one decimal, `null` without revenue |
| `approved` | Whether the payouts are committed |

`getProjectFinance` also returns `category`, `costBudgetMinor` and `costs[]` (including voided ones, with
`voidedAt` and `voidReason`). `getPayoutForecast` returns `rows[]` per month (`owedNowMinor`,
`pendingApprovalMinor`, `inProgressMinor`, `totalMinor`), `laterMinor`, `owedNowMinor` and the `pipeline[]` of
unapproved projects. `getPayoutAging` returns `buckets[]` and the `oldest` unpaid balances. `getUtilisation`
returns one row per active person with `tasksCompleted`, `unestimated`, `completedHours`, `capacityHours` and
`utilisationPct`.

Good candidates for charts in the redesign: profit by category and client (bar), the monthly forecast (stacked bar),
aging buckets (bar), utilisation per person (bar with a 100% line). The numbers are all ready to plot; no extra
calculation is needed in the browser.
