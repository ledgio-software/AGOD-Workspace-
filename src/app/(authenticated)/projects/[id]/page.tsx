import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  CircleCheck,
  CircleX,
  FileText,
  Lock,
  MessagesSquare,
  Paperclip,
  Receipt,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Badge, HealthBadge, ProgressBar, ProjectStatusBadge, TaskStatusBadge } from "@/components/badges";
import { FileList, type FileItem, FileUploadForm } from "@/components/files";
import { Avatar, ButtonLink, Callout, Card, Disclosure, EmptyState, cx, table } from "@/components/ui";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { costCategoryLabel, describeAuditAction, healthLabel, milestoneStatusLabel, payoutStatusLabel, projectCategoryLabel } from "@/lib/labels";
import { formatMoney, formatPercent, minorToInput } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getProjectPayouts } from "@/modules/approvals";
import { type AttachmentView, attachmentsAvailable, listProjectAttachments } from "@/modules/attachments";
import { listComments } from "@/modules/comments";
import { getProjectFinance } from "@/modules/finance";
import { getProjectGithub, isGithubConfigured } from "@/modules/github";
import { listTemplates } from "@/modules/templates";
import { listCustomerOptions } from "@/modules/customers";
import { getProjectWorkspace, listActiveMembers } from "@/modules/projects";
import { acceptsTaskUpdates, allowedManualTransitions, isEditable, isTaskOverdue } from "@/modules/projects/rules";
import { applyTemplateAction, saveAsTemplateAction } from "../../templates/actions";
import { ApplyTemplateForm, SaveAsTemplateForm } from "../../templates/template-form";
import {
  addAssignmentAction,
  addCommentAction,
  approveAction,
  changeStatusAction,
  createMilestoneAction,
  healthOverrideAction,
  createTaskAction,
  milestoneStatusAction,
  rejectAction,
  projectFinanceAction,
  recordCostAction,
  removeAssignmentAction,
  removeFileAction,
  voidCostAction,
  setRepoAction,
  uploadProjectFileAction,
  uploadTaskFileAction,
  reopenAction,
  requestApprovalAction,
  taskProgressAction,
  updateAssignmentAction,
  updateProjectAction,
  updateTaskDetailsAction,
  waiveTaskAction,
} from "../actions";
import { ProjectForm } from "../project-form";
import { ApproveForm, RejectForm, ReopenForm, RequestApprovalForm } from "./approval-forms";
import { DeliveryHistory, TaskGithub } from "./github-panel";
import {
  AddAssignmentForm,
  AssignmentRowActions,
  CommentForm,
  CostForm,
  ProjectFinanceForm,
  VoidCostForm,
  RepoForm,
  HealthOverrideForm,
  MilestoneForm,
  MilestoneStatusForm,
  StatusControls,
  TaskForm,
  TaskProgressForm,
  WaiveForm,
} from "./workspace-forms";

const TABS = ["overview", "tasks", "team", "discussion", "files", "activity"] as const;
type Tab = (typeof TABS)[number];

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
      ) : (
        <CircleX className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
      )}
      <span>{children}</span>
    </li>
  );
}

export default async function ProjectWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ws = await getProjectWorkspace(actor, id);
  if (!ws) notFound();
  const requested = (await searchParams).tab;
  const tab: Tab = (TABS as readonly string[]).includes(requested ?? "") ? (requested as Tab) : "overview";

  const { project } = ws;
  const isManager = can(actor, "project.edit");
  const editable = isEditable(project.status);
  const canManage = isManager && editable;
  const members = isManager ? await listActiveMembers(actor) : [];
  const customerOptions = canManage ? await listCustomerOptions(actor, project.customerId) : [];
  const teamOptions = Array.from(new Map(ws.team.map((t) => [t.memberId, { id: t.memberId, name: t.memberName }])).values());
  const pct = project.splitMode === "PERCENTAGE";
  const workOpen = acceptsTaskUpdates(project.status);
  const [payouts, discussion, github, files, finance] = await Promise.all([
    getProjectPayouts(actor, project.id),
    listComments(actor, project.id),
    getProjectGithub(actor, project.id),
    listProjectAttachments(actor, project.id),
    can(actor, "finance.view") ? getProjectFinance(actor, project.id) : Promise.resolve(null),
  ]);
  const githubReady = isGithubConfigured();
  const uploadsReady = attachmentsAvailable();
  const toItems = (list: AttachmentView[]): FileItem[] =>
    list.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      sizeBytes: f.sizeBytes,
      uploaderName: f.uploaderName,
      createdAt: formatDateTime(f.createdAt),
      remove: isManager || f.uploadedBy === actor.id ? removeFileAction.bind(null, project.id, f.id) : undefined,
    }));
  const templates = canManage && can(actor, "template.manage") ? await listTemplates(actor) : [];
  const lastReturn = ws.activity.find((a) => a.action === "project.changes_requested");
  const canRequest = project.status === "IN_PROGRESS" || project.status === "CHANGES_REQUESTED";
  const doneTasks = ws.tasks.filter((t) => t.status === "DONE" || t.status === "WAIVED").length;
  const taskFileCount = [...files.byTask.values()].reduce((n, list) => n + list.length, 0);
  const href = (t: Tab) => (t === "overview" ? `/projects/${project.id}` : `/projects/${project.id}?tab=${t}`);
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "tasks", label: "Tasks", count: ws.tasks.length },
    { key: "team", label: isManager ? "Team & money" : "Team" },
    { key: "discussion", label: "Discussion", count: discussion.length },
    { key: "files", label: "Files", count: files.project.length + taskFileCount },
    { key: "activity", label: "Activity" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> Projects
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <ProjectStatusBadge status={project.status} />
              <HealthBadge health={ws.health} />
            </div>
            <p className="text-sm text-muted">
              <span className="font-mono text-xs">{project.code}</span> · {project.clientType === "INTERNAL" ? (
                "Internal project"
              ) : isManager && project.customerId ? (
                <Link href={`/customers/${project.customerId}`} className="hover:text-fg hover:underline">
                  {project.clientName}
                </Link>
              ) : (
                project.clientName
              )}{" "}
              ·
              Owner {ws.ownerName}
            </p>
          </div>
          <ButtonLink href={`/projects/${project.id}/statement`}>
            <FileText className="size-4" aria-hidden /> Statement
          </ButtonLink>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-line bg-surface p-4 shadow-xs sm:grid-cols-3 lg:grid-cols-5">
          <Meta label="Project value">
            <span className="tabular-nums">{formatMoney(project.totalValueMinor, project.currency)}</span>
          </Meta>
          <Meta label="Split">
            {pct ? "Percentages" : "Fixed amounts"}
            {pct && project.agodShareBasisPoints > 0 && <span className="text-muted"> · AGOD {formatPercent(project.agodShareBasisPoints)}</span>}
          </Meta>
          <Meta label="Tasks done">
            <span className="tabular-nums">
              {doneTasks} / {ws.tasks.length}
            </span>
          </Meta>
          <Meta label="Dates">
            {formatCalendarDate(project.startDate)} → {formatCalendarDate(project.targetDate)}
          </Meta>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-xs text-muted">Progress</dt>
            <dd className="mt-1.5">
              <ProgressBar progress={ws.progress} />
            </dd>
          </div>
        </dl>

        {!editable && (
          <Callout tone="warn" icon={Lock}>
            This project is locked for editing while it is {project.status.toLowerCase().replace("_", " ")}.
          </Callout>
        )}
        {project.status === "CHANGES_REQUESTED" && lastReturn && (
          <Callout tone="warn" icon={TriangleAlert}>
            Returned for changes by {lastReturn.actorName}: “{lastReturn.reason}”
          </Callout>
        )}

        <nav aria-label="Project sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex min-w-max gap-1 border-b border-line">
            {tabs.map((t) => {
              const active = t.key === tab;
              return (
                <li key={t.key}>
                  <Link
                    href={href(t.key)}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition",
                      active ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300" : "border-transparent text-muted hover:border-line-strong hover:text-fg",
                    )}
                  >
                    {t.label}
                    {t.count !== undefined && t.count > 0 && (
                      <span className="rounded-full bg-surface-muted px-1.5 text-[11px] tabular-nums text-muted">{t.count}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card title="Approval and payouts" aside={<Receipt className="size-4 text-muted" aria-hidden />}>
              <div className="space-y-5 text-sm">
                {canRequest && (
                  <div className="space-y-3">
                    <ul className="space-y-1.5">
                      {ws.compensation && (
                        <Check ok={ws.compensation.valid}>
                          {ws.compensation.valid ? (
                            "Compensation plan is valid"
                          ) : (
                            <>
                              Compensation plan needs fixing (
                              <Link href={href("team")} className="text-brand-600 hover:underline dark:text-brand-400">
                                see Team
                              </Link>
                              )
                            </>
                          )}
                        </Check>
                      )}
                      <Check ok={ws.readiness.incompleteTasks.length === 0}>
                        {ws.readiness.incompleteTasks.length === 0
                          ? "All required tasks are done or waived"
                          : `${ws.readiness.incompleteTasks.length} required task(s) still open: ${ws.readiness.incompleteTasks.map((t) => t.title).join(", ")}`}
                      </Check>
                    </ul>
                    <RequestApprovalForm action={requestApprovalAction.bind(null, project.id)} />
                  </div>
                )}

                {project.status === "PENDING_APPROVAL" &&
                  (isManager ? (
                    <div className="grid gap-6 md:grid-cols-2">
                      <div className="space-y-3">
                        <p className="text-muted">
                          Review the{" "}
                          <Link href={href("team")} className="text-brand-600 hover:underline dark:text-brand-400">
                            calculation preview
                          </Link>{" "}
                          and the{" "}
                          <Link href={href("tasks")} className="text-brand-600 hover:underline dark:text-brand-400">
                            completed tasks
                          </Link>
                          , then decide.
                        </p>
                        {ws.readiness.blockers.length > 0 && (
                          <ul className="list-disc space-y-1 pl-5 text-red-600 dark:text-red-400">
                            {ws.readiness.blockers.map((b) => (
                              <li key={b}>{b}</li>
                            ))}
                          </ul>
                        )}
                        {ws.readiness.incompleteTasks.length > 0 && (
                          <p className="text-amber-700 dark:text-amber-400">
                            Required tasks not done: {ws.readiness.incompleteTasks.map((t) => t.title).join(", ")}.
                          </p>
                        )}
                        {ws.readiness.blockers.length === 0 && ws.compensation && (
                          <ApproveForm
                            action={approveAction.bind(null, project.id)}
                            expectedVersion={project.version}
                            needsOverride={ws.readiness.incompleteTasks.length > 0}
                            totalLabel={formatMoney(ws.compensation.allocatedMinor, project.currency)}
                          />
                        )}
                      </div>
                      <RejectForm action={rejectAction.bind(null, project.id)} />
                    </div>
                  ) : (
                    <p className="text-muted">Waiting for a project manager to review and approve.</p>
                  ))}

                {payouts.length === 0 && !canRequest && project.status !== "PENDING_APPROVAL" && (
                  <p className="text-muted">No approvals yet. Approval becomes available once the project is in progress.</p>
                )}

                {[...payouts].reverse().map((snapshot) => (
                  <div key={snapshot.id} className="space-y-2">
                    <p>
                      <span className="font-medium">Snapshot {snapshot.sequence}</span>
                      <span className="text-muted">
                        {" "}
                        · approved by {snapshot.approverName} on {formatDateTime(snapshot.createdAt)} · value{" "}
                        {formatMoney(snapshot.projectTotalValueMinor, snapshot.currency)}
                      </span>
                    </p>
                    {snapshot.calculationNotes && <p className="text-xs text-muted">{snapshot.calculationNotes}</p>}
                    <div className="overflow-x-auto rounded-lg border border-line">
                      <table className={table.table}>
                        <thead className={table.head}>
                          <tr>
                            <th className="px-3 py-2 font-medium">Recipient</th>
                            <th className="px-3 py-2 font-medium">Role</th>
                            <th className="px-3 py-2 text-right font-medium">Split</th>
                            <th className="px-3 py-2 text-right font-medium">Owed</th>
                            <th className="px-3 py-2 font-medium">Payout</th>
                          </tr>
                        </thead>
                        <tbody>
                          {snapshot.lines.map((line) => (
                            <tr key={line.id} className={table.row}>
                              <td className="px-3 py-2">{line.memberName}</td>
                              <td className="px-3 py-2 text-muted">{line.roleOnProject}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {line.splitType === "PERCENTAGE"
                                  ? formatPercent(line.splitBasisPoints ?? 0)
                                  : formatMoney(line.splitAmountMinor ?? 0, line.currency)}
                              </td>
                              <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(line.amountOwedMinor, line.currency)}</td>
                              <td className="px-3 py-2">
                                {line.ledgerStatus ? (
                                  <Badge tone={line.ledgerStatus === "PAID" ? "green" : line.ledgerStatus === "VOIDED" ? "gray" : "amber"}>
                                    {payoutStatusLabel[line.ledgerStatus]}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted">No payout (zero amount)</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {project.status === "COMPLETED" && can(actor, "project.reopen") && (
                  <Disclosure summary="Reopen this project (Admin)">
                    <ReopenForm action={reopenAction.bind(null, project.id)} />
                  </Disclosure>
                )}
              </div>
            </Card>

            <Card title="About this project">
              <div className="space-y-4 text-sm">
                {project.description ? <p className="whitespace-pre-line">{project.description}</p> : <p className="text-muted">No description.</p>}
                {ws.healthOverride && (
                  <p className="rounded-lg bg-surface-muted p-3">
                    Health set to <strong>{healthLabel[ws.healthOverride.health]}</strong> by {ws.healthOverride.byName ?? "a manager"}
                    {ws.healthOverride.at && <> on {formatDateTime(ws.healthOverride.at)}</>}: “{ws.healthOverride.reason}”.
                    {ws.calculatedHealth && <> Calculated health: {healthLabel[ws.calculatedHealth]}.</>}
                  </p>
                )}
                <p className="text-muted">
                  GitHub:{" "}
                  {project.githubRepo ? (
                    <a
                      href={`https://github.com/${project.githubRepo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {project.githubRepo}
                    </a>
                  ) : (
                    "not connected"
                  )}
                </p>
              </div>
            </Card>

            {github && (github.repo || github.mergedPullRequests.length > 0) && (
              <Card title="Delivery" description="Pull requests, deployments and releases from GitHub">
                <DeliveryHistory delivery={github} taskKeys={new Map(ws.tasks.map((t) => [t.id, `${project.code}-T${t.number}`]))} />
              </Card>
            )}
          </div>

          {isManager && (
            <div className="space-y-6">
              <Card title="Manage">
                <div className="space-y-4">
                  <StatusControls action={changeStatusAction.bind(null, project.id)} allowed={allowedManualTransitions(project.status)} />
                  {can(actor, "project.overrideHealth") && ws.calculatedHealth && (
                    <HealthOverrideForm action={healthOverrideAction.bind(null, project.id)} current={ws.healthOverride?.health ?? null} />
                  )}
                  <Disclosure summary={project.githubRepo ? "Change GitHub repository" : "Connect a GitHub repository"}>
                    <RepoForm action={setRepoAction.bind(null, project.id)} current={project.githubRepo} />
                  </Disclosure>
                </div>
              </Card>
            </div>
          )}

          {canManage && (
            <div className="lg:col-span-3">
              <Disclosure summary="Edit project details" className="bg-surface shadow-xs">
                <ProjectForm
                  action={updateProjectAction.bind(null, project.id)}
                  members={members}
                  customers={customerOptions}
                  submitLabel="Save changes"
                  splitModeLocked={ws.team.length > 0}
                  defaults={{
                    name: project.name,
                    description: project.description,
                    clientType: project.clientType,
                    customerId: project.customerId,
                    totalValue: minorToInput(project.totalValueMinor),
                    splitMode: project.splitMode,
                    agodShare: String(project.agodShareBasisPoints / 100),
                    projectOwnerId: project.projectOwnerId,
                    startDate: project.startDate,
                    targetDate: project.targetDate,
                    version: project.version,
                  }}
                />
              </Disclosure>
            </div>
          )}
        </div>
      )}

      {/* Tasks */}
      {tab === "tasks" && (
        <div className="space-y-6">
          {(ws.milestones.length > 0 || canManage) && (
            <Card title="Milestones">
              <div className="space-y-4">
                {ws.milestones.length === 0 ? (
                  <p className="text-sm text-muted">No milestones yet.</p>
                ) : (
                  <ul className="-my-2 divide-y divide-line">
                    {ws.milestones.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium">{m.title}</span>
                          <span className="ml-2 text-muted">
                            {milestoneStatusLabel[m.status]}
                            {m.dueDate && ` · due ${formatCalendarDate(m.dueDate)}`}
                          </span>
                        </span>
                        {canManage && <MilestoneStatusForm action={milestoneStatusAction.bind(null, project.id, m.id)} status={m.status} />}
                      </li>
                    ))}
                  </ul>
                )}
                {canManage && (
                  <Disclosure summary="Add a milestone">
                    <MilestoneForm action={createMilestoneAction.bind(null, project.id)} />
                  </Disclosure>
                )}
              </div>
            </Card>
          )}

          <Card
            title="Tasks"
            description={`${doneTasks} of ${ws.tasks.length} done`}
            aside={<ProgressBar progress={ws.progress} />}
          >
            {ws.tasks.length === 0 ? (
              <EmptyState title="No tasks yet">{canManage ? "Add tasks below or start from a template." : undefined}</EmptyState>
            ) : (
              <ul className="-my-4 divide-y divide-line">
                {ws.tasks.map((task) => {
                  const mine = task.assignedTo === actor.id;
                  const canUpdate = workOpen && (isManager || mine) && (task.status !== "WAIVED" || isManager);
                  const milestone = ws.milestones.find((m) => m.id === task.milestoneId);
                  const taskFiles = toItems(files.byTask.get(task.id) ?? []);
                  return (
                    <li key={task.id} className="grid gap-4 py-4 md:grid-cols-[1fr_18rem]">
                      <div className="min-w-0 space-y-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted">T{task.number}</span>
                          <span className="font-medium">{task.title}</span>
                          <TaskStatusBadge status={task.status} />
                          {!task.required && <Badge>Optional</Badge>}
                          {isTaskOverdue(task, ws.today) && <Badge tone="red">Overdue</Badge>}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                          <span className="inline-flex items-center gap-1.5">
                            {task.assigneeName ? <Avatar name={task.assigneeName} size="sm" /> : null}
                            {task.assigneeName ?? "Unassigned"}
                          </span>
                          {milestone && <span>{milestone.title}</span>}
                          {task.dueDate && <span>Due {formatCalendarDate(task.dueDate)}</span>}
                          {task.estimateHours && <span>{task.estimateHours}h estimated</span>}
                        </div>
                        {task.description && <p className="whitespace-pre-line text-fg/90">{task.description}</p>}
                        {task.status === "DONE" && (
                          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                            Done {task.completedAt && formatCalendarDate(task.completedAt.toISOString().slice(0, 10))}: {task.completionNote}
                            {task.evidenceUrl && (
                              <>
                                {" · "}
                                <a href={task.evidenceUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                                  evidence
                                </a>
                              </>
                            )}
                          </p>
                        )}
                        {task.status === "BLOCKED" && (
                          <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800 dark:bg-red-950/40 dark:text-red-200">
                            <span className="font-medium">Blocked:</span> {task.blockedReason}. <span className="font-medium">Needs:</span> {task.blockedNeeds}
                          </p>
                        )}
                        {task.status === "WAIVED" && <p className="text-muted">Waived: {task.waivedReason}</p>}
                        <TaskGithub
                          projectId={project.id}
                          projectCode={project.code}
                          task={task}
                          links={github?.byTask.get(task.id) ?? []}
                          canLink={isManager || mine}
                          canManage={isManager}
                          canCreateIssue={isManager && githubReady && !!project.githubRepo}
                        />
                        <FileList files={taskFiles} />
                        {(isManager || mine) && uploadsReady && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted hover:text-fg">Attach a file</summary>
                            <div className="mt-2">
                              <FileUploadForm action={uploadTaskFileAction.bind(null, project.id, task.id)} label="Attach" />
                            </div>
                          </details>
                        )}
                      </div>
                      <div className="space-y-3">
                        {canUpdate && <TaskProgressForm action={taskProgressAction.bind(null, project.id, task.id)} status={task.status} today={ws.today} />}
                        {canManage && (
                          <details className="text-sm">
                            <summary className="cursor-pointer text-muted hover:text-fg">Edit or waive</summary>
                            <div className="mt-2 space-y-4">
                              <TaskForm
                                action={updateTaskDetailsAction.bind(null, project.id, task.id)}
                                team={teamOptions}
                                milestones={ws.milestones}
                                submitLabel="Save task"
                                defaults={task}
                              />
                              {task.status !== "WAIVED" && <WaiveForm action={waiveTaskAction.bind(null, project.id, task.id)} />}
                            </div>
                          </details>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {canManage && (
            <div className="space-y-3">
              <Disclosure summary="Add a task" className="bg-surface shadow-xs">
                <TaskForm action={createTaskAction.bind(null, project.id)} team={teamOptions} milestones={ws.milestones} submitLabel="Add task" reset />
              </Disclosure>
              {can(actor, "template.manage") && (
                <div className="rounded-lg border border-line bg-surface p-4 shadow-xs">
                  <ApplyTemplateForm
                    action={applyTemplateAction.bind(null, project.id)}
                    templates={templates.map((t) => ({ id: t.id, name: t.name, tasks: t.counts.tasks }))}
                  />
                </div>
              )}
            </div>
          )}
          {can(actor, "template.manage") && ws.tasks.length > 0 && (
            <Disclosure summary="Save as a template" className="bg-surface shadow-xs">
              <SaveAsTemplateForm action={saveAsTemplateAction.bind(null, project.id)} />
            </Disclosure>
          )}
        </div>
      )}

      {/* Team & money */}
      {tab === "team" && (
        <div className="space-y-6">
          <Card title="Team and compensation" aside={<Users className="size-4 text-muted" aria-hidden />}>
            <div className="space-y-5">
              {ws.team.length === 0 ? (
                <EmptyState icon={Users} title="No team members yet" />
              ) : (
                <div className="-mx-5 -mt-4 overflow-x-auto border-b border-line">
                  <table className={table.table}>
                    <thead className={table.head}>
                      <tr>
                        <th className={table.th}>Member</th>
                        <th className={table.th}>Role</th>
                        <th className={`${table.th} text-right`}>Split</th>
                        <th className={`${table.th} text-right`}>Amount</th>
                        {canManage && <th className={table.th} />}
                      </tr>
                    </thead>
                    <tbody>
                      {ws.team.map((t) => {
                        const line = ws.compensation?.lines.find((l) => l.assignmentId === t.assignmentId);
                        return (
                          <tr key={t.assignmentId} className={cx(table.row, "align-top")}>
                            <td className={table.td}>
                              <span className="inline-flex items-center gap-2">
                                <Avatar name={t.memberName} size="sm" />
                                <span>
                                  {t.memberName}
                                  {!t.memberActive && <span className="ml-1 text-xs text-muted">(inactive)</span>}
                                </span>
                              </span>
                            </td>
                            <td className={`${table.td} text-muted`}>{t.roleOnProject}</td>
                            <td className={table.num}>
                              {t.split ? (
                                t.split.type === "PERCENTAGE" ? (
                                  formatPercent(t.split.basisPoints ?? 0)
                                ) : (
                                  formatMoney(t.split.amountMinor ?? 0, project.currency)
                                )
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                              {t.split?.rationale && <div className="text-xs font-normal text-muted">{t.split.rationale}</div>}
                            </td>
                            <td className={`${table.num} font-medium`}>
                              {line ? (
                                <>
                                  {formatMoney(line.amountMinor, project.currency)}
                                  {line.roundingAdjustmentMinor > 0 && (
                                    <div className="text-xs font-normal text-muted">incl. +{line.roundingAdjustmentMinor} pesewa rounding</div>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            {canManage && t.split && (
                              <td className={`${table.td} text-right`}>
                                <AssignmentRowActions
                                  splitMode={project.splitMode}
                                  updateAction={updateAssignmentAction.bind(null, project.id, t.assignmentId)}
                                  removeAction={removeAssignmentAction.bind(null, project.id, t.assignmentId)}
                                  defaults={{
                                    roleOnProject: t.roleOnProject,
                                    split: t.split.type === "PERCENTAGE" ? String((t.split.basisPoints ?? 0) / 100) : minorToInput(t.split.amountMinor ?? 0),
                                    rationale: t.split.rationale ?? "",
                                  }}
                                />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {ws.compensation && (
                <div className="space-y-3 rounded-lg bg-surface-muted p-4 text-sm">
                  <p className="font-medium">Calculation preview</p>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted">Project value</dt>
                      <dd className="font-semibold tabular-nums">{formatMoney(project.totalValueMinor, project.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">To the team</dt>
                      <dd className="font-semibold tabular-nums">{formatMoney(ws.compensation.allocatedMinor, project.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Kept by AGOD</dt>
                      <dd className="font-semibold tabular-nums text-brand-700 dark:text-brand-300">
                        {formatMoney(ws.compensation.agodShareMinor, project.currency)}
                        {pct && project.agodShareBasisPoints > 0 && (
                          <span className="ml-1 text-xs font-normal text-muted">({formatPercent(project.agodShareBasisPoints)})</span>
                        )}
                      </dd>
                    </div>
                    {pct && ws.compensation.unallocatedMinor !== 0 && (
                      <div>
                        <dt className="text-xs text-muted">Unallocated</dt>
                        <dd className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                          {formatMoney(ws.compensation.unallocatedMinor, project.currency)}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {/* Plain sentence kept for screen readers and tests. */}
                  <p className="sr-only">
                    Project value {formatMoney(project.totalValueMinor, project.currency)} · to the team {formatMoney(ws.compensation.allocatedMinor, project.currency)} ·
                    kept by AGOD {formatMoney(ws.compensation.agodShareMinor, project.currency)}
                    {pct && project.agodShareBasisPoints > 0 && <> ({formatPercent(project.agodShareBasisPoints)})</>}
                  </p>
                  {ws.compensation.roundingNote && <p className="text-muted">{ws.compensation.roundingNote}</p>}
                  {ws.compensation.valid ? (
                    <p className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                      <CircleCheck className="size-4" aria-hidden /> The plan is valid.
                    </p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-5 text-red-600 dark:text-red-400">
                      {ws.compensation.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted">Amounts become payable only when the project is approved. Completing tasks never creates a payout.</p>
                </div>
              )}

              {canManage && (
                <Disclosure summary="Add someone to the team">
                  <AddAssignmentForm action={addAssignmentAction.bind(null, project.id)} members={members} splitMode={project.splitMode} />
                </Disclosure>
              )}
            </div>
          </Card>

          {finance && (
            <Card
              id="finance"
              title="Finance"
              description={`${projectCategoryLabel[finance.category]} · visible to PMs and Admins only`}
              aside={
                <Badge tone={finance.financials.actualProfitMinor < 0 ? "red" : "green"}>
                  Margin {finance.financials.actualMarginPct === null ? "—" : `${finance.financials.actualMarginPct}%`}
                </Badge>
              }
            >
              <div className="space-y-5">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {(
                    [
                      ["Revenue", finance.financials.revenueMinor],
                      [
                        finance.financials.approved ? "Payouts (approved)" : "Payouts (planned)",
                        finance.financials.approved ? finance.financials.committedPayoutMinor : finance.financials.plannedPayoutMinor,
                      ],
                      ["Other costs", finance.financials.actualCostMinor],
                      ["Cost budget", finance.costBudgetMinor],
                      ["Estimated profit", finance.financials.estimatedProfitMinor],
                      ["Profit", finance.financials.actualProfitMinor],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-line p-3">
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className={cx("mt-0.5 font-semibold tabular-nums", value < 0 && "text-red-600 dark:text-red-400")}>{formatMoney(value)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm text-muted">
                  Margin: {finance.financials.actualMarginPct === null ? "— (internal project, no revenue)" : `${finance.financials.actualMarginPct}%`}
                  {finance.financials.costOverBudgetMinor > 0 && finance.costBudgetMinor > 0 && (
                    <span className="text-red-600 dark:text-red-400"> · costs over budget by {formatMoney(finance.financials.costOverBudgetMinor)}</span>
                  )}
                </p>
                {can(actor, "finance.manage") && (
                  <ProjectFinanceForm action={projectFinanceAction.bind(null, project.id)} category={finance.category} costBudget={minorToInput(finance.costBudgetMinor)} />
                )}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Costs other than contributor payouts</h3>
                  {finance.costs.length === 0 ? (
                    <p className="text-sm text-muted">None recorded.</p>
                  ) : (
                    <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                      {finance.costs.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                          <div className={cx("min-w-0", c.voidedAt && "text-muted line-through")}>
                            <p className="font-medium">{c.description}</p>
                            <p className="text-xs text-muted">
                              {formatCalendarDate(c.incurredOn)} · {costCategoryLabel[c.category]}
                              {c.vendor && ` · ${c.vendor}`} · by {c.createdByName}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={cx("font-semibold tabular-nums", c.voidedAt && "text-muted line-through")}>{formatMoney(c.amountMinor, c.currency)}</p>
                            {c.voidedAt ? (
                              <p className="text-xs text-muted">Voided: {c.voidReason}</p>
                            ) : (
                              can(actor, "finance.manage") && (
                                <details className="text-xs">
                                  <summary className="cursor-pointer text-muted hover:text-fg">Void</summary>
                                  <div className="mt-2">
                                    <VoidCostForm action={voidCostAction.bind(null, project.id, c.id)} />
                                  </div>
                                </details>
                              )
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {can(actor, "finance.manage") && project.status !== "CANCELLED" && (
                    <Disclosure summary="Record a cost">
                      <CostForm action={recordCostAction.bind(null, project.id)} today={ws.today} />
                    </Disclosure>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Discussion */}
      {tab === "discussion" && (
        <Card title="Discussion" aside={<MessagesSquare className="size-4 text-muted" aria-hidden />}>
          <div className="space-y-6">
            {discussion.length === 0 ? (
              <EmptyState icon={MessagesSquare} title="No comments yet">
                Ask a question or share an update. Mention someone with @Full Name to notify them.
              </EmptyState>
            ) : (
              <ul className="space-y-5">
                {discussion.map((c) => (
                  <li key={c.id} className="flex gap-3">
                    <Avatar name={c.authorName} />
                    <div className="min-w-0 flex-1 space-y-1 text-sm">
                      <p className="text-xs text-muted">
                        <span className="text-sm font-medium text-fg">{c.authorName}</span> · {formatDateTime(c.createdAt)}
                        {c.taskTitle && <> · on “{c.taskTitle}”</>}
                        {c.mentionedNames.length > 0 && <> · mentioned {c.mentionedNames.join(", ")}</>}
                      </p>
                      <p className="whitespace-pre-line rounded-lg rounded-tl-none bg-surface-muted px-3 py-2">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line pt-5">
              <CommentForm action={addCommentAction.bind(null, project.id)} tasks={ws.tasks.map((t) => ({ id: t.id, title: t.title }))} />
            </div>
          </div>
        </Card>
      )}

      {/* Files */}
      {tab === "files" && (
        <div className="space-y-6">
          <Card title="Project documents" aside={<Paperclip className="size-4 text-muted" aria-hidden />}>
            <div className="space-y-4">
              {files.project.length === 0 ? (
                <EmptyState icon={Paperclip} title="No project documents yet">
                  Briefs, contracts and sign-offs go here. Files attached to tasks are listed below.
                </EmptyState>
              ) : (
                <FileList files={toItems(files.project)} />
              )}
              {isManager &&
                (uploadsReady ? (
                  <div className="border-t border-line pt-4">
                    <FileUploadForm action={uploadProjectFileAction.bind(null, project.id)} />
                  </div>
                ) : (
                  <p className="text-xs text-muted">File uploads are not set up in this environment yet (see docs/SETUP.md).</p>
                ))}
            </div>
          </Card>
          {taskFileCount > 0 && (
            <Card title="Task files">
              <ul className="-my-2 divide-y divide-line">
                {ws.tasks
                  .filter((t) => (files.byTask.get(t.id) ?? []).length > 0)
                  .map((t) => (
                    <li key={t.id} className="space-y-1.5 py-3">
                      <p className="text-sm font-medium">
                        <span className="font-mono text-xs text-muted">T{t.number}</span> {t.title}
                      </p>
                      <FileList files={toItems(files.byTask.get(t.id) ?? [])} />
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* Activity */}
      {tab === "activity" && (
        <Card title="Activity" aside={<Activity className="size-4 text-muted" aria-hidden />}>
          {ws.activity.length === 0 ? (
            <EmptyState icon={Activity} title="No activity you can see yet" />
          ) : (
            <ol className="relative space-y-4 border-l border-line pl-5">
              {ws.activity.map((a) => (
                <li key={a.id} className="relative text-sm">
                  <span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-line-strong ring-4 ring-surface" aria-hidden />
                  <p>
                    <span className="font-medium">{a.actorName ?? "System"}</span> <span className="text-muted">{describeAuditAction(a.action)}</span>
                    {a.reason && <span className="text-muted"> — “{a.reason}”</span>}
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(a.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}
