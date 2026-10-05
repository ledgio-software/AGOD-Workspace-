import Link from "next/link";
import { notFound } from "next/navigation";
import { HealthBadge, ProgressBar, ProjectStatusBadge, TaskStatusBadge } from "@/components/badges";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { costCategoryLabel, describeAuditAction, healthLabel, milestoneStatusLabel, payoutStatusLabel, projectCategoryLabel } from "@/lib/labels";
import { formatMoney, formatPercent, minorToInput } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getProjectPayouts } from "@/modules/approvals";
import { FileList, type FileItem, FileUploadForm } from "@/components/files";
import { type AttachmentView, attachmentsAvailable, listProjectAttachments } from "@/modules/attachments";
import { listComments } from "@/modules/comments";
import { getProjectFinance } from "@/modules/finance";
import { getProjectGithub, isGithubConfigured } from "@/modules/github";
import { listTemplates } from "@/modules/templates";
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

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default async function ProjectWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ws = await getProjectWorkspace(actor, id);
  if (!ws) notFound();

  const { project } = ws;
  const isManager = can(actor, "project.edit");
  const editable = isEditable(project.status);
  const canManage = isManager && editable;
  const members = isManager ? await listActiveMembers(actor) : [];
  const teamOptions = Array.from(new Map(ws.team.map((t) => [t.memberId, { id: t.memberId, name: t.memberName }])).values());
  const pct = project.splitMode === "PERCENTAGE";
  const workOpen = acceptsTaskUpdates(project.status);
  const payouts = await getProjectPayouts(actor, project.id);
  const discussion = await listComments(actor, project.id);
  const github = await getProjectGithub(actor, project.id);
  const githubReady = isGithubConfigured();
  const files = await listProjectAttachments(actor, project.id);
  const finance = can(actor, "finance.view") ? await getProjectFinance(actor, project.id) : null;
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

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <Link href="/projects" className="text-sm text-zinc-500 hover:underline">
          ← Projects
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <ProjectStatusBadge status={project.status} />
          <HealthBadge health={ws.health} />
        </div>
        <p className="text-sm text-zinc-500">
          {project.code} · {project.clientType === "INTERNAL" ? "Internal" : project.clientName} · Owner {ws.ownerName} ·{" "}
          <Link href={`/projects/${project.id}/statement`} className="underline">
            Statement
          </Link>
        </p>
        {!editable && (
          <p className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            This project is locked for editing in its current status ({project.status.toLowerCase().replace("_", " ")}).
          </p>
        )}
      </div>

      <Section title="Overview" aside={<ProgressBar progress={ws.progress} />}>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-zinc-500">Value</dt>
            <dd className="tabular-nums">{formatMoney(project.totalValueMinor, project.currency)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Split mode</dt>
            <dd>
              {pct ? "Percentages" : "Fixed amounts"}
              {pct && project.agodShareBasisPoints > 0 && <> · AGOD keeps {formatPercent(project.agodShareBasisPoints)}</>}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Start</dt>
            <dd>{formatCalendarDate(project.startDate)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Target</dt>
            <dd>{formatCalendarDate(project.targetDate)}</dd>
          </div>
        </dl>
        {project.description && <p className="text-sm">{project.description}</p>}
        {ws.healthOverride && (
          <p className="rounded-md bg-zinc-50 p-2 text-sm dark:bg-zinc-900">
            Health set to <strong>{healthLabel[ws.healthOverride.health]}</strong> by {ws.healthOverride.byName ?? "a manager"}
            {ws.healthOverride.at && <> on {formatDateTime(ws.healthOverride.at)}</>}: “{ws.healthOverride.reason}”.
            {ws.calculatedHealth && <> Calculated health: {healthLabel[ws.calculatedHealth]}.</>}
          </p>
        )}
        <p className="text-sm text-zinc-500">
          GitHub:{" "}
          {project.githubRepo ? (
            <a href={`https://github.com/${project.githubRepo}`} target="_blank" rel="noopener noreferrer" className="underline">
              {project.githubRepo}
            </a>
          ) : (
            "not connected"
          )}
        </p>
        {isManager && (
          <details>
            <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-400">
              {project.githubRepo ? "Change GitHub repository" : "Connect a GitHub repository"}
            </summary>
            <div className="mt-2">
              <RepoForm action={setRepoAction.bind(null, project.id)} current={project.githubRepo} />
            </div>
          </details>
        )}
        {can(actor, "project.overrideHealth") && ws.calculatedHealth && (
          <HealthOverrideForm action={healthOverrideAction.bind(null, project.id)} current={ws.healthOverride?.health ?? null} />
        )}
        {isManager && (
          <StatusControls action={changeStatusAction.bind(null, project.id)} allowed={allowedManualTransitions(project.status)} />
        )}
        {canManage && (
          <details>
            <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-400">Edit project details</summary>
            <div className="mt-4">
              <ProjectForm
                action={updateProjectAction.bind(null, project.id)}
                members={members}
                submitLabel="Save changes"
                splitModeLocked={ws.team.length > 0}
                defaults={{
                  name: project.name,
                  description: project.description,
                  clientType: project.clientType,
                  clientName: project.clientName,
                  totalValue: minorToInput(project.totalValueMinor),
                  splitMode: project.splitMode,
                  agodShare: String(project.agodShareBasisPoints / 100),
                  projectOwnerId: project.projectOwnerId,
                  startDate: project.startDate,
                  targetDate: project.targetDate,
                  version: project.version,
                }}
              />
            </div>
          </details>
        )}
      </Section>

      <Section title="Team and compensation">
        {ws.team.length === 0 ? (
          <p className="text-sm text-zinc-500">No team members yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="py-2 pr-4 font-medium">Member</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Split</th>
                  <th className="py-2 pr-4 font-medium">Calculated amount</th>
                  {canManage && <th className="py-2 font-medium" />}
                </tr>
              </thead>
              <tbody>
                {ws.team.map((t) => {
                  const line = ws.compensation?.lines.find((l) => l.assignmentId === t.assignmentId);
                  return (
                    <tr key={t.assignmentId} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                      <td className="py-2 pr-4">
                        {t.memberName}
                        {!t.memberActive && <span className="ml-1 text-xs text-zinc-500">(inactive)</span>}
                      </td>
                      <td className="py-2 pr-4">{t.roleOnProject}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {t.split
                          ? t.split.type === "PERCENTAGE"
                            ? formatPercent(t.split.basisPoints ?? 0)
                            : formatMoney(t.split.amountMinor ?? 0, project.currency)
                          : <span className="text-zinc-400">—</span>}
                        {t.split?.rationale && <div className="text-xs text-zinc-500">{t.split.rationale}</div>}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {line ? (
                          <>
                            {formatMoney(line.amountMinor, project.currency)}
                            {line.roundingAdjustmentMinor > 0 && (
                              <div className="text-xs text-zinc-500">incl. +{line.roundingAdjustmentMinor} pesewa rounding</div>
                            )}
                          </>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      {canManage && t.split && (
                        <td className="py-2">
                          <AssignmentRowActions
                            splitMode={project.splitMode}
                            updateAction={updateAssignmentAction.bind(null, project.id, t.assignmentId)}
                            removeAction={removeAssignmentAction.bind(null, project.id, t.assignmentId)}
                            defaults={{
                              roleOnProject: t.roleOnProject,
                              split:
                                t.split.type === "PERCENTAGE"
                                  ? String((t.split.basisPoints ?? 0) / 100)
                                  : minorToInput(t.split.amountMinor ?? 0),
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
          <div className="space-y-1 rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
            <p className="font-medium">Calculation preview</p>
            <p>
              Project value {formatMoney(project.totalValueMinor, project.currency)} · to the team{" "}
              {formatMoney(ws.compensation.allocatedMinor, project.currency)} · kept by AGOD{" "}
              <strong>{formatMoney(ws.compensation.agodShareMinor, project.currency)}</strong>
              {pct && project.agodShareBasisPoints > 0 && <> ({formatPercent(project.agodShareBasisPoints)})</>}
              {pct && ws.compensation.unallocatedMinor !== 0 && (
                <>
                  {" "}
                  · unallocated <strong>{formatMoney(ws.compensation.unallocatedMinor, project.currency)}</strong>
                </>
              )}
            </p>
            {ws.compensation.roundingNote && <p className="text-zinc-600 dark:text-zinc-400">{ws.compensation.roundingNote}</p>}
            {ws.compensation.valid ? (
              <p className="text-green-700 dark:text-green-500">The plan is valid.</p>
            ) : (
              <ul className="list-disc pl-5 text-red-600">
                {ws.compensation.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-zinc-500">
              Amounts become payable only when the project is approved. Completing tasks never creates a payout.
            </p>
          </div>
        )}

        {canManage && (
          <AddAssignmentForm action={addAssignmentAction.bind(null, project.id)} members={members} splitMode={project.splitMode} />
        )}
      </Section>

      <Section title="Milestones and tasks">
        {ws.milestones.length > 0 && (
          <ul className="space-y-2 text-sm">
            {ws.milestones.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{m.title}</strong>
                  <span className="ml-2 text-zinc-500">
                    {milestoneStatusLabel[m.status]}
                    {m.dueDate && ` · due ${formatCalendarDate(m.dueDate)}`}
                  </span>
                </span>
                {canManage && <MilestoneStatusForm action={milestoneStatusAction.bind(null, project.id, m.id)} status={m.status} />}
              </li>
            ))}
          </ul>
        )}
        {canManage && <MilestoneForm action={createMilestoneAction.bind(null, project.id)} />}

        {ws.tasks.length === 0 ? (
          <p className="text-sm text-zinc-500">No tasks yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {ws.tasks.map((task) => {
              const mine = task.assignedTo === actor.id;
              const canUpdate = workOpen && (isManager || mine) && (task.status !== "WAIVED" || isManager);
              const milestone = ws.milestones.find((m) => m.id === task.milestoneId);
              return (
                <li key={task.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_18rem]">
                  <div className="space-y-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{task.title}</span>
                      <TaskStatusBadge status={task.status} />
                      {!task.required && <span className="text-xs text-zinc-500">optional</span>}
                      {isTaskOverdue(task, ws.today) && <span className="text-xs font-medium text-red-600">overdue</span>}
                    </div>
                    <div className="text-zinc-500">
                      {task.assigneeName ?? "Unassigned"}
                      {milestone && ` · ${milestone.title}`}
                      {task.dueDate && ` · due ${formatCalendarDate(task.dueDate)}`}
                      {task.estimateHours && ` · ${task.estimateHours}h estimated`}
                    </div>
                    {task.description && <p>{task.description}</p>}
                    {task.status === "DONE" && (
                      <p className="text-green-800 dark:text-green-400">
                        Done {task.completedAt && formatCalendarDate(task.completedAt.toISOString().slice(0, 10))}: {task.completionNote}
                        {task.evidenceUrl && (
                          <>
                            {" "}
                            <a href={task.evidenceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                              evidence
                            </a>
                          </>
                        )}
                      </p>
                    )}
                    {task.status === "BLOCKED" && (
                      <p className="text-red-700 dark:text-red-400">
                        Blocked: {task.blockedReason}. Needs: {task.blockedNeeds}
                      </p>
                    )}
                    {task.status === "WAIVED" && <p className="text-zinc-500">Waived: {task.waivedReason}</p>}
                    <TaskGithub
                      projectId={project.id}
                      projectCode={project.code}
                      task={task}
                      links={github?.byTask.get(task.id) ?? []}
                      canLink={isManager || mine}
                      canManage={isManager}
                      canCreateIssue={isManager && githubReady && !!project.githubRepo}
                    />
                    <FileList files={toItems(files.byTask.get(task.id) ?? [])} />
                    {(isManager || mine) && uploadsReady && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-zinc-500">Attach a file</summary>
                        <div className="mt-2">
                          <FileUploadForm action={uploadTaskFileAction.bind(null, project.id, task.id)} label="Attach" />
                        </div>
                      </details>
                    )}
                  </div>
                  <div className="space-y-3">
                    {canUpdate && (
                      <TaskProgressForm action={taskProgressAction.bind(null, project.id, task.id)} status={task.status} today={ws.today} />
                    )}
                    {canManage && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">Edit or waive</summary>
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

        {canManage && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Add a task</summary>
            <div className="mt-3">
              <TaskForm
                action={createTaskAction.bind(null, project.id)}
                team={teamOptions}
                milestones={ws.milestones}
                submitLabel="Add task"
                reset
              />
            </div>
          </details>
        )}
        {canManage && can(actor, "template.manage") && (
          <ApplyTemplateForm
            action={applyTemplateAction.bind(null, project.id)}
            templates={templates.map((t) => ({ id: t.id, name: t.name, tasks: t.counts.tasks }))}
          />
        )}
        {can(actor, "template.manage") && ws.tasks.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-400">Save as a template</summary>
            <div className="mt-3">
              <SaveAsTemplateForm action={saveAsTemplateAction.bind(null, project.id)} />
            </div>
          </details>
        )}
      </Section>

      <Section title="Approval and payouts">
        {project.status === "CHANGES_REQUESTED" && lastReturn && (
          <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Returned for changes by {lastReturn.actorName}: “{lastReturn.reason}”
          </p>
        )}

        {canRequest && (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              {ws.compensation && (
                <li>{ws.compensation.valid ? "✓ Compensation plan is valid" : "✗ Compensation plan needs fixing (see above)"}</li>
              )}
              <li>
                {ws.readiness.incompleteTasks.length === 0
                  ? "✓ All required tasks are done or waived"
                  : `• ${ws.readiness.incompleteTasks.length} required task(s) still open: ${ws.readiness.incompleteTasks.map((t) => t.title).join(", ")}`}
              </li>
            </ul>
            <RequestApprovalForm action={requestApprovalAction.bind(null, project.id)} />
          </div>
        )}

        {project.status === "PENDING_APPROVAL" &&
          (isManager ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2 text-sm">
                <p>Review the calculation preview, the completed tasks and their evidence above, then decide.</p>
                {ws.readiness.blockers.length > 0 && (
                  <ul className="list-disc pl-5 text-red-600">
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
            <p className="text-sm text-zinc-500">Waiting for a project manager to review and approve.</p>
          ))}

        {payouts.length === 0 && !canRequest && project.status !== "PENDING_APPROVAL" && (
          <p className="text-sm text-zinc-500">No approvals yet.</p>
        )}

        {[...payouts].reverse().map((snapshot) => (
          <div key={snapshot.id} className="space-y-2 text-sm">
            <p>
              <strong>Snapshot {snapshot.sequence}</strong> · approved by {snapshot.approverName} on {formatDateTime(snapshot.createdAt)} ·
              value {formatMoney(snapshot.projectTotalValueMinor, snapshot.currency)}
              {snapshot.calculationNotes && <span className="text-zinc-500"> · {snapshot.calculationNotes}</span>}
            </p>
            <table className="w-full text-left">
              <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="py-1 pr-4 font-medium">Recipient</th>
                  <th className="py-1 pr-4 font-medium">Role</th>
                  <th className="py-1 pr-4 font-medium">Split</th>
                  <th className="py-1 pr-4 font-medium">Amount owed</th>
                  <th className="py-1 font-medium">Payout</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.lines.map((line) => (
                  <tr key={line.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-1 pr-4">{line.memberName}</td>
                    <td className="py-1 pr-4">{line.roleOnProject}</td>
                    <td className="py-1 pr-4 tabular-nums">
                      {line.splitType === "PERCENTAGE"
                        ? formatPercent(line.splitBasisPoints ?? 0)
                        : formatMoney(line.splitAmountMinor ?? 0, line.currency)}
                    </td>
                    <td className="py-1 pr-4 tabular-nums">{formatMoney(line.amountOwedMinor, line.currency)}</td>
                    <td className="py-1">{line.ledgerStatus ? payoutStatusLabel[line.ledgerStatus] : "No payout (zero amount)"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {project.status === "COMPLETED" && can(actor, "project.reopen") && (
          <ReopenForm action={reopenAction.bind(null, project.id)} />
        )}
      </Section>

      {github && (github.repo || github.mergedPullRequests.length > 0) && (
        <Section title="Delivery">
          <DeliveryHistory delivery={github} taskKeys={new Map(ws.tasks.map((t) => [t.id, `${project.code}-T${t.number}`]))} />
        </Section>
      )}

      {finance && (
        <section id="finance" className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Finance</h2>
            <span className="text-sm text-zinc-500">{projectCategoryLabel[finance.category]} · visible to PMs and Admins only</span>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
            {(
              [
                ["Revenue", finance.financials.revenueMinor],
                [finance.financials.approved ? "Payouts (approved)" : "Payouts (planned)", finance.financials.approved ? finance.financials.committedPayoutMinor : finance.financials.plannedPayoutMinor],
                ["Other costs", finance.financials.actualCostMinor],
                ["Cost budget", finance.costBudgetMinor],
                ["Estimated profit", finance.financials.estimatedProfitMinor],
                ["Profit", finance.financials.actualProfitMinor],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-zinc-500">{label}</dt>
                <dd className={`tabular-nums ${value < 0 ? "text-red-600" : ""}`}>{formatMoney(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-zinc-500">
            Margin: {finance.financials.actualMarginPct === null ? "— (internal project, no revenue)" : `${finance.financials.actualMarginPct}%`}
            {finance.financials.costOverBudgetMinor > 0 && finance.costBudgetMinor > 0 && (
              <span className="text-red-600"> · costs over budget by {formatMoney(finance.financials.costOverBudgetMinor)}</span>
            )}
          </p>
          {can(actor, "finance.manage") && (
            <ProjectFinanceForm action={projectFinanceAction.bind(null, project.id)} category={finance.category} costBudget={minorToInput(finance.costBudgetMinor)} />
          )}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Costs other than contributor payouts</h3>
            {finance.costs.length === 0 ? (
              <p className="text-sm text-zinc-500">None recorded.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {finance.costs.map((c) => (
                  <li key={c.id} className={c.voidedAt ? "text-zinc-400 line-through" : ""}>
                    {formatCalendarDate(c.incurredOn)} · {costCategoryLabel[c.category]} · {c.description}
                    {c.vendor && ` · ${c.vendor}`} · <strong>{formatMoney(c.amountMinor, c.currency)}</strong>
                    <span className="text-zinc-500"> · by {c.createdByName}</span>
                    {c.voidedAt ? (
                      <span className="no-underline"> (voided: {c.voidReason})</span>
                    ) : (
                      can(actor, "finance.manage") && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-zinc-500">Void</summary>
                          <VoidCostForm action={voidCostAction.bind(null, project.id, c.id)} />
                        </details>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
            {can(actor, "finance.manage") && project.status !== "CANCELLED" && (
              <CostForm action={recordCostAction.bind(null, project.id)} today={ws.today} />
            )}
          </div>
        </section>
      )}

      <Section title={`Project files (${files.project.length})`}>
        {files.project.length === 0 ? (
          <p className="text-sm text-zinc-500">No project documents yet. Files attached to tasks appear under each task.</p>
        ) : (
          <FileList files={toItems(files.project)} />
        )}
        {isManager &&
          (uploadsReady ? (
            <FileUploadForm action={uploadProjectFileAction.bind(null, project.id)} />
          ) : (
            <p className="text-xs text-zinc-500">File uploads are not set up in this environment yet (see docs/SETUP.md).</p>
          ))}
      </Section>

      <Section title={`Discussion (${discussion.length})`}>
        {discussion.length === 0 ? (
          <p className="text-sm text-zinc-500">No comments yet.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {discussion.map((c) => (
              <li key={c.id} className="space-y-1">
                <div className="text-zinc-500">
                  <strong className="text-zinc-900 dark:text-zinc-100">{c.authorName}</strong> · {formatDateTime(c.createdAt)}
                  {c.taskTitle && <> · on “{c.taskTitle}”</>}
                  {c.mentionedNames.length > 0 && <> · mentioned {c.mentionedNames.join(", ")}</>}
                </div>
                <p className="whitespace-pre-line">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        <CommentForm action={addCommentAction.bind(null, project.id)} tasks={ws.tasks.map((t) => ({ id: t.id, title: t.title }))} />
      </Section>

      <Section title="Activity">
        {ws.activity.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity you can see yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {ws.activity.map((a) => (
              <li key={a.id}>
                <span className="text-zinc-500">{formatDateTime(a.createdAt)}</span> ·{" "}
                <strong>{a.actorName ?? "System"}</strong> {describeAuditAction(a.action)}
                {a.reason && <span className="text-zinc-600 dark:text-zinc-400"> — “{a.reason}”</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
