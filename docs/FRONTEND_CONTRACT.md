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
| `/projects/new` (`?customer=<id>` presets the customer) | `project.create` | `listActiveMembers`, `listCustomerOptions` | `createProjectAction` (`customerId`, or `clientName` for a new customer) |
| `/projects/[id]` | anyone who can see the project | `getProjectWorkspace`, `getProjectPayouts`, `listComments`, `listProjectAttachments`, `getProjectGithub`, `getProjectFinance` (`finance.view`), `listTemplates`, `listProjectLinks`, `driveFolderLink` | `projects/actions`: project edit/status/health, team (`addAssignmentAction`, ...), milestones, tasks, approvals, comments, GitHub, files, links (`addLinkAction`, `removeLinkAction`), Drive (`createDriveFolderAction`), finance (`projectFinanceAction`, `recordCostAction`, `voidCostAction`) |
| `/customers` | `customer.view` | `listCustomers({ q, status })` | |
| `/customers/new`, `/customers/[id]` | `customer.view` | `getCustomer` | `customers/actions` (`customer.manage`): customer create/edit/archive/restore, contacts add/edit/deactivate |
| `/subscriptions` | `subscription.view` | `listSubscriptions({ q, status, attention, within, customerId })`, `recurringTotals` | |
| `/subscriptions/new` (`?customer=<id>`) | `subscription.manage` | `listCustomerOptions`, `listServiceOptions` | `createSubscriptionAction` |
| `/subscriptions/[id]` | `subscription.view` | `getSubscription`, `renewalSuggestion` | `subscriptions/actions`: `changeStatusAction`, `updateDraftAction`, `amendAction`, `renewAction`, `updateDetailsAction` |
| `/services` | `subscription.view` | `listServices` | `createServiceAction`, `updateServiceAction`, `setServiceActiveAction` |
| `/account` | everyone | `getDailyEmail` | `account/actions`: `setDailyEmailAction` |
| `/company` | `company.manage` | `getOrganization` | `company/actions`: `updateCompanyAction`; `switchCompanyAction` (the sidebar company menu, any member of several companies) |
| `/no-company` | signed in, no active company | `getSignedIn`, `signupOpen` | `no-company/actions`: `createOwnCompanyAction` (while sign-up is open) |
| `/sign-up`, `/forgot-password`, `/reset-password` | public | `signupOpen`, `emailConfig` | Better Auth client: `signUp.email` (with `pendingCompany`), `requestPasswordReset`, `resetPassword` |
| `/integrations` (`?google=<result>`) | `audit.viewAll` | `recentJobRuns`, `recentDeliveries`, `emailConfig`, `googleStatus` | `integrations/actions`: `sendTestEmailAction`, `runDailyNowAction`, `syncDriveAction`, `disconnectGoogleAction` (`google.manage`); `/api/google/connect` → Google → `/api/google/callback` |
| `/invoices` | `invoice.view` | `listInvoices({ q, state, customerId })`, `invoiceTotals` | `invoices/actions`: `prepareAction` |
| `/invoices/new` (`?customer=<id>`) | `invoice.manage` | `listCustomerOptions` | `createDraftAction` |
| `/invoices/[id]` (+ `/invoices/[id]/pdf`) | `invoice.view` | `getInvoice`, `invoiceSources` (drafts) | `addLineAction`, `addPeriodAction`, `removeLineAction`, `notesAction`, `issueAction`, `deleteDraftAction`, `sendAction`, `voidAction`, `saveToDriveAction`; `paymentAction`, `voidPaymentAction` (`invoice.recordPayment`) |
| `/invoices/settings` | `invoice.settings` | `getInvoiceSettings` | `settingsAction` |
| `/projects/[id]/statement` | anyone who can see the project | `getProjectStatement` | |
| `/payouts/[id]` | the payee, managers | `getPayout`, `questionsForPayout`, `listPaymentReceipts` | `payouts/actions`: payments, adjustments, questions, receipts |
| `/ledger` (+ `/ledger/export`) | `payout.viewAll` | `listLedger` | |
| `/questions` | `payoutQuestion.review` | `listQuestions` | `payouts/actions` (review, resolve) |
| `/close` (+ `/close/export`) | `period.view` | `getPeriodClose`, `periodMovements` | `close/actions`: `closePeriodAction`, `reopenPeriodAction` (`period.close`) |
| `/reconcile` | `payout.viewAll` | | `reconcile/actions`: `reconcileAction` |
| `/profitability` (+ `/profitability/export`) | `finance.view` | `getProfitability({ scope, category })`, `getRecurringRevenue` (`?view=recurring`), `getPayoutForecast`, `getPayoutAging`, `getUtilisation(month)` | |
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
| `plannedPayoutMinor` | Payouts to the team from the current compensation plan (excludes the AGOD share) |
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

## AGOD share (Phase 11)

The project form sends `agodShare` (a percentage such as "30", percentage mode only). Projects have
`agodShareBasisPoints`; the compensation preview (`getProjectWorkspace(...).compensation`) has `allocatedMinor`
(to the team), `agodShareMinor` (kept by AGOD) and `unallocatedMinor`; approval snapshots store
`agodShareBasisPoints` and `agodShareMinor`.

## Design system (Phase 12)

The redesign is rolled out in phases: Phase 12 built the foundation, the app shell, the sign-in page, the
Dashboard and My Work. Later phases move the remaining pages onto the same pieces.

- **Tokens** (`src/app/globals.css`): use the semantic colours, not raw greys: `bg-canvas` (page), `bg-surface`
  (cards), `bg-surface-muted`, `border-line`, `border-line-strong`, `text-fg`, `text-muted`, and the accent
  `brand-50…950` (indigo). Light and dark mode follow the device setting.
- **Building blocks** (`src/components/ui.tsx`): `PageHeader`, `Card`, `StatCard`, `EmptyState`, `Callout`,
  `ButtonLink` / `buttonClass`, `List` / `ListRow`, `Avatar`, and `table` class names for data tables.
- **Badges** (`src/components/badges.tsx`): `Badge` with tones, plus the status, health and progress badges.
- **Forms** (`src/components/form.tsx`): `inputClass`, `Field`, `SubmitButton` (primary, secondary, danger).
- **Shell** (`src/components/shell.tsx`, `nav.tsx`): the sidebar groups come from `navGroups(actor)`; add a page
  there with its permission. Icons are from `lucide-react`.
- **Lists that can grow** use `ExpandableList` (`src/components/expandable-list.tsx`).

### Project page tabs (Phase 13)

`/projects/[id]?tab=` selects a section: `overview` (default: approval and payouts, about, delivery, manager
controls, edit details), `tasks` (milestones, tasks, add task, templates), `team` (team, compensation preview and,
for managers, the Finance card `#finance`), `discussion`, `files` (project and task files) and `activity`. Server
actions keep the URL, so a form submitted on a tab stays on that tab. Link to finance with
`/projects/<id>?tab=team#finance`. Occasional forms sit in a collapsible "Disclosure" block.

### Charts (Phase 14)

`src/components/charts.tsx` has two server-rendered chart components with no chart library:
- `BarList`: horizontal bars for one measure, with negative values and an optional reference line.
- `StackedColumns`: stacked columns over time, with a legend and axis labels.

Series colours are `bg-series-1/2/3` and `bg-negative`, defined in `globals.css` for light and dark mode. They
were checked with the dataviz palette validator against both surfaces, so keep that order: the order is what
keeps them colour-blind safe. Every mark has a hover/focus tooltip, and every chart has a table with the same
numbers. Other shared pieces: `TabNav`, `compactTable`, `PayoutStatusBadge` and `QuestionStatusBadge`.

### Redesign complete (Phase 15)

Every page now uses the design system; no page uses raw grey classes any more (badges use them for their grey
tone only). `Disclosure` (in `ui.tsx`) is the collapsible block for occasional forms such as add a member, a task or
a template.

