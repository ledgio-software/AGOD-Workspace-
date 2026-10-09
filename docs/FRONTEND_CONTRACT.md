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
| `/projects/[id]` | anyone who can see the project | `getProjectWorkspace`, `getProjectPayouts`, `listComments`, `listProjectAttachments`, `getProjectGithub`, `getProjectFinance` (`finance.view`), `listTemplates`, `listProjectLinks`, `driveFolderLink`, `listMeetings`, `meetingsAvailable` | `projects/actions`: project edit/status/health, team (`addAssignmentAction`, ...), milestones, tasks, approvals, comments, GitHub, files, links (`addLinkAction`, `removeLinkAction`), Drive (`createDriveFolderAction`), finance (`projectFinanceAction`, `recordCostAction`, `voidCostAction`), meetings (`scheduleMeetingAction`, `cancelMeetingAction`) |
| `/customers` | `customer.view` | `listCustomers({ q, status })` | |
| `/customers/new`, `/customers/[id]` | `customer.view` | `getCustomer` | `customers/actions` (`customer.manage`): customer create/edit/archive/restore, contacts add/edit/deactivate |
| `/subscriptions` | `subscription.view` | `listSubscriptions({ q, status, attention, within, customerId })`, `recurringTotals` | |
| `/subscriptions/new` (`?customer=<id>`) | `subscription.manage` | `listCustomerOptions`, `listServiceOptions` | `createSubscriptionAction` |
| `/subscriptions/[id]` | `subscription.view` | `getSubscription`, `renewalSuggestion` | `subscriptions/actions`: `changeStatusAction`, `updateDraftAction`, `amendAction`, `renewAction`, `updateDetailsAction` |
| `/services` | `subscription.view` | `listServices` | `createServiceAction`, `updateServiceAction`, `setServiceActiveAction` |
| `/account` (`?google=<result>`) | everyone | `getDailyEmail`, `personalCalendarStatus` | `account/actions`: `setDailyEmailAction`, `syncMyCalendarAction`, `disconnectMyCalendarAction`; `/api/google/connect?kind=personal` → Google → `/api/google/callback` |
| `/company` | `company.manage` | `getOrganization` | `company/actions`: `updateCompanyAction`; `switchCompanyAction` (the sidebar company menu, any member of several companies) |
| `/no-company` | | | Redirects to `/community` (Phase 25) |
| `/` , `/members`, `/members/[handle]`, `/code-of-conduct` | public | `communityStats`, `listMembers`, `memberCities`, `getProfile` | `reportProfileAction` (signed in); organizers: `unhideProfileAction`, `setOrganizerAction` |
| `/community` | signed in (company optional) | `ensureProfile`, `onboarding`, `companiesOf`, `listMembers`, `chatLinks` | `community/actions`: `acceptConductAction`, `createCompanyAction`; `switchCompanyAction` |
| `/community/profile` | signed in | `ensureProfile` | `updateProfileAction`; change password (Better Auth) |
| `/community/reports` | organizers | `listReports` | `resolveReportAction` |
| `/showcase` | public | `listPosts({ status, q, page, order })` | |
| `/showcase/[id]` (+ `/showcase/[id]/images/[imageId]`) | public (members-only posts: signed in) | `getPost`, `openScreenshot` | `addReviewAction`, `replyToReviewAction`, `reportPostAction`, `reportReviewAction`; author: `setPostStatusAction`, `addScreenshotAction`, `removeScreenshotAction`, `removePostAction`; organizers: `unhideShowcaseAction` |
| `/sessions` (`?show=recordings`) | public | `listSessions("upcoming" \| "past")` | |
| `/sessions/[id]` (+ `/sessions/[id]/calendar.ics`) | public (call link: host, attendees, organizers) | `getSession`, `sessionIcs` | `joinSessionAction`, `leaveSessionAction`, `reportSessionAction`; host: `addRecordingAction`, `cancelSessionAction`; organizers: `cancelSessionAction`, `unhideSessionAction` |
| `/community/sessions/new`, `/community/sessions/[id]/edit` | Reviewers and organizers (host) | `hostingStatus`, `getSession` | `createSessionAction`, `updateSessionAction` |
| `/community/showcase/new`, `/community/showcase/[id]/edit` | signed in (author) | `giveBack`, `screenshotsAvailable`, `getPost` | `createPostAction` (with an optional screenshot), `updatePostAction` |
| `/sign-up`, `/forgot-password`, `/reset-password` | public | `signupOpen`, `emailConfig` | Better Auth client: `signUp.email` (with `pendingCompany`), `requestPasswordReset`, `resetPassword` |
| `/integrations` (`?google=<result>`) | `audit.viewAll` | `recentJobRuns`, `recentDeliveries`, `emailConfig`, `googleStatus`, `companyCalendarStatus` | `integrations/actions`: `sendTestEmailAction`, `runDailyNowAction`, `syncDriveAction` (Drive and calendars), `disconnectGoogleAction` (`google.manage`); `/api/google/connect` → Google → `/api/google/callback` |
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
| `/projects/[id]?tab=billing` | client project and `project.edit` or `invoice.view` | `getBilling` | `projects/[id]/billing-actions` (`project.edit`; invoicing `invoice.manage`) |
| `/projects/[id]?tab=releases` | release approvals on (or the project has releases) | `listProjectReleases`, `releaseControlOn` | `releases/actions`: `createReleaseAction` (redirects to the release) |
| `/releases` | signed in to a company (menu link when release approvals are on) | `releaseOverview`, `releaseControlOn` | |
| `/releases/[id]` | anyone who can see the project | `getRelease` (with what the viewer may do now) | `releases/actions`: `updateReleaseAction`, `submitReleaseAction`, `withdrawReleaseAction`, `securityReviewAction`, `decideReleaseAction`, `deployReleaseAction`, `rollBackReleaseAction` |
| `/releases/export?from=&to=` | `audit.viewAll` | `releaseEvidenceCsv` | (GET, CSV download, audited) |
| `/messages` (`?c=`, `?new=1`, `?to=`) | signed in to a company | `listConversations`, `openConversation`, `messageablePeople`, `voiceNotesAvailable` | `messages/actions` (members of the conversation): `sendMessageAction`, `sendStickerAction`, `sendVoiceAction`, `reactAction`, `startConversationAction` |
| `/messages/voice/[id]` | people in the conversation | `openVoiceNote` | (GET, audio with byte ranges) |
| `/api/messages/unread` | signed in to a company | `unreadMessageCount` | (GET, polled by the message icon) |
| `/mentors`, `/library`, `/library/[id]` | everyone (public) | `listMentors`, `listItems`, `getItem` | `community/growth-actions` (signed-in members) |
| `/community/mentoring`, `/community/library/new`, `/community/library/[id]/edit` | community members | `myMentorships`, `getItem` | `community/growth-actions` |
| `/community/chat/[slug]` (`?thread=`) | community members | `listChannels`, `openChannel`, `openThread` | `community/chat/actions`: `postChatAction`, `reactChatAction`, `solveChatAction`, `deleteChatAction`, `reportChatAction`, `hideChatAction`, `suggestPeopleAction` |
| `/articles` (`?sort=useful\|reviewed&tag=&q=`) | public | `articleFeed`, `articleTags` | — |
| `/articles/[id]` | public (drafts: author; hidden: author and organizers) | `getArticle` | `community/article-actions`: `usefulArticleAction`, `bookmarkAction`, `commentAction`, `deleteCommentAction`, `repostAction`, `reviewArticleAction`, `reportArticleAction`, `reportCommentAction`, `publishAction`, `removeArticleAction`, `unhideArticleAction` |
| `/articles/[id]/cover` | public (published, visible) | `openCover` | (GET) |
| `/community/articles`, `/community/articles/new`, `/community/articles/[id]/edit` | members | `myArticles`, `getArticle`, `coversAvailable` | `createArticleAction`, `updateArticleAction` (cover upload; `intent=publish` publishes) |
| `/news` (`?topic=AI\|PROGRAMMING\|AFRICA\|RELEASES\|TECH&sort=top&q=`) | public | `newsFeed`, `newsUpdatedAt` (and `refreshNews` after the response when stale) | `community/news-actions`: `usefulNewsAction`, `hideNewsAction` (organizers) |
| `/console`, `/console/companies[/id]`, `/console/people[/id]`, `/console/moderation`, `/console/content`, `/console/log` | AGOD staff (`PLATFORM_ADMIN_EMAILS`); others get 404 | `modules/platform`: `asStaff`, `overview`, `health`, `listCompanies`, `getCompany`, `listPeople`, `getPerson`, `openReports`, `hiddenItems`, `listOrganizers`, `platformLog` | `console/actions`: `suspendCompanyAction`, `blockLoginAction`, `resetLinkAction`, `organizerAction` |
| `/search` (`?q=`) | public | `searchCommunity` (`MIN_QUERY` = 2) | — |
| `/sitemap.xml`, `/robots.txt`, `/opengraph-image` | public | `app/sitemap.ts`, `app/robots.ts`, `app/opengraph-image.tsx` (`lib/site.ts`: `indexingAllowed`, `pageMetadata`) | (GET) |
| `/community/news` | organizers | `newsSourceStatus` | `community/news-actions`: `newsSourceAction`, `refreshNewsAction` |
| `/api/community/chat` | community members | `?channel=&known=`, `?thread=&known=`, `?channels=1` (polled by the open chat; "unchanged" when nothing changed) | (GET) |
| `/` and `/community` banner | everyone | `frontPage` (photos, welcome video) | |
| `/community/front-page` | organizers | `frontPage`, `photosAvailable` | `community/front-page/actions`: `addPhotoAction`, `removePhotoAction`, `videoAction` |
| `/front/photos/[id]` | everyone (public) | `openFrontPhoto` | (GET, image) |
| `/jobs`, `/jobs/[id]`, `/teams`, `/teams/[id]` | everyone (public) | `listJobs`, `getJob`, `listTeamPosts`, `getTeamPost` | `community/work-actions` (signed-in members) |
| `/community/jobs` (`/new`, `/[id]/edit`), `/community/teams` (`/new`, `/[id]/edit`) | community members | `myJobs`, `getJob`, `myTeams`, `getTeamPost` | `community/work-actions` |
| `/team/roles` | `team.view` | `listRoles`, `listJobTitles`, `needsTeamSetup` | `team/roles/actions` (`team.manage`; team type also `company.manage`) |
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

