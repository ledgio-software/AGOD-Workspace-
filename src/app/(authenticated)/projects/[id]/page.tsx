import Link from "next/link";
import { notFound } from "next/navigation";
import { HealthBadge, ProgressBar, ProjectStatusBadge, TaskStatusBadge } from "@/components/badges";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { describeAuditAction, milestoneStatusLabel } from "@/lib/labels";
import { formatMoney, formatPercent, minorToInput } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getProjectWorkspace, listActiveMembers } from "@/modules/projects";
import { acceptsTaskUpdates, allowedManualTransitions, isEditable, isTaskOverdue } from "@/modules/projects/rules";
import {
  addAssignmentAction,
  changeStatusAction,
  createMilestoneAction,
  createTaskAction,
  milestoneStatusAction,
  removeAssignmentAction,
  taskProgressAction,
  updateAssignmentAction,
  updateProjectAction,
  updateTaskDetailsAction,
  waiveTaskAction,
} from "../actions";
import { ProjectForm } from "../project-form";
import {
  AddAssignmentForm,
  AssignmentRowActions,
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
          {project.code} · {project.clientType === "INTERNAL" ? "Internal" : project.clientName} · Owner {ws.ownerName}
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
            <dd>{pct ? "Percentages" : "Fixed amounts"}</dd>
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
              Project value {formatMoney(project.totalValueMinor, project.currency)} · allocated{" "}
              {formatMoney(ws.compensation.allocatedMinor, project.currency)} · unallocated{" "}
              <strong>{formatMoney(ws.compensation.unallocatedMinor, project.currency)}</strong>
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
