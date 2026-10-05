import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
import { ProjectStatusBadge, TaskStatusBadge } from "@/components/badges";
import { formatCalendarDate, formatDate, formatDateTime } from "@/lib/dates";
import { adjustmentTypeLabel, paymentMethodLabel, payoutStatusLabel, roleLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getContributionHistory } from "@/modules/work/history";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}
const none = <p className="text-sm text-zinc-500">None.</p>;

export default async function ContributionHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (id !== actor.id && !can(actor, "team.view")) return <AccessDenied what="other people's history" />;
  const h = await getContributionHistory(actor, id);
  if (!h) notFound();
  const { member, workload, totals } = h;

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        {can(actor, "team.view") ? (
          <Link href="/team" className="text-sm text-zinc-500 hover:underline">
            ← Team
          </Link>
        ) : (
          <Link href="/my-work" className="text-sm text-zinc-500 hover:underline">
            ← My work
          </Link>
        )}
        <h1 className="text-xl font-semibold">Contribution history: {member.name}</h1>
        <p className="text-sm text-zinc-500">
          {member.email} · {roleLabel[member.role]} · {member.active ? "Active" : "Inactive"} · member since {formatDate(member.createdAt)}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-8">
        {(
          [
            ["Active projects", workload.activeProjects],
            ["Open tasks", workload.open],
            ["In progress", workload.inProgress],
            ["Blocked", workload.blocked],
            ["Overdue", workload.overdue],
            ["Completed", workload.completed],
            ["Owed", formatMoney(totals.owedMinor)],
            ["Remaining", formatMoney(totals.remainingMinor)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className="font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <Section title="Projects and roles">
        {h.projects.length === 0
          ? none
          : (
            <ul className="space-y-1 text-sm">
              {h.projects.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/projects/${p.id}`} className="underline">
                    {p.code} {p.name}
                  </Link>
                  <ProjectStatusBadge status={p.status} />
                  <span className="text-zinc-500">{p.roles.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
      </Section>

      <Section title="Open tasks">
        {h.openTasks.length === 0
          ? none
          : (
            <ul className="space-y-1 text-sm">
              {h.openTasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2">
                  <TaskStatusBadge status={t.status} />
                  <span>
                    {t.projectCode} · {t.title}
                  </span>
                  {t.dueDate && (
                    <span className={t.overdue ? "text-red-600" : "text-zinc-500"}>
                      due {formatCalendarDate(t.dueDate)}
                      {t.overdue && " (overdue)"}
                    </span>
                  )}
                  {t.status === "BLOCKED" && <span className="text-zinc-500">· {t.blockedReason}</span>}
                </li>
              ))}
            </ul>
          )}
      </Section>

      <Section title={`Completed work (${h.completedTasks.length} tasks, ${h.completedMilestones.length} milestones)`}>
        {h.completedTasks.length === 0
          ? none
          : (
            <ul className="space-y-2 text-sm">
              {h.completedTasks.map((t) => (
                <li key={t.id}>
                  <strong>
                    {t.projectCode} · {t.title}
                  </strong>
                  {t.completedAt && <span className="text-zinc-500"> · {formatDate(t.completedAt)}</span>}
                  <div className="text-zinc-600 dark:text-zinc-400">
                    {t.completionNote}
                    {t.evidenceUrl && (
                      <>
                        {" · "}
                        <a href={t.evidenceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                          evidence
                        </a>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        {h.completedMilestones.length > 0 && (
          <p className="text-sm text-zinc-500">
            Milestones completed on their projects: {h.completedMilestones.map((m) => `${m.projectCode} ${m.title}`).join(" · ")}
          </p>
        )}
      </Section>

      <Section title="Payouts">
        {h.payouts.length === 0
          ? none
          : (
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Project</th>
                  <th className="py-1 pr-3 font-medium">Role</th>
                  <th className="py-1 pr-3 text-right font-medium">Owed</th>
                  <th className="py-1 pr-3 text-right font-medium">Paid</th>
                  <th className="py-1 pr-3 text-right font-medium">Remaining</th>
                  <th className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {h.payouts.map((p) => (
                  <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="py-1 pr-3">
                      <Link href={`/payouts/${p.id}`} className="underline">
                        {p.projectCode}
                      </Link>
                    </td>
                    <td className="py-1 pr-3">{p.roleOnProject}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(p.effectiveOwedMinor, p.currency)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(p.paidMinor, p.currency)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(p.remainingMinor, p.currency)}</td>
                    <td className="py-1">{payoutStatusLabel[p.status]}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-300 font-semibold dark:border-zinc-700">
                  <td className="py-1 pr-3" colSpan={2}>
                    Total (excluding voided)
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(totals.owedMinor)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(totals.paidMinor)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(totals.remainingMinor)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
      </Section>

      <Section title="Payment and adjustment history">
        {h.payments.length + h.adjustments.length === 0
          ? none
          : (
            <ul className="space-y-1 text-sm">
              {[
                ...h.payments.map((p) => ({
                  id: p.id,
                  at: p.paidAt,
                  // Payments carry a calendar date only (stored at noon UTC).
                  when: formatCalendarDate(p.paidAt.toISOString().slice(0, 10)),
                  text: `${p.projectCode} · paid ${formatMoney(p.amountMinor, p.currency)} by ${paymentMethodLabel[p.method]}${p.reference ? `, ref ${p.reference}` : ""}`,
                })),
                ...h.adjustments.map((a) => ({
                  id: a.id,
                  at: a.createdAt,
                  when: formatDateTime(a.createdAt),
                  text: `${a.projectCode} · ${adjustmentTypeLabel[a.type]}${a.type === "VOID" ? "" : ` ${formatMoney(a.amountMinor)}`}: “${a.reason}”`,
                })),
              ]
                .sort((a, b) => b.at.getTime() - a.at.getTime())
                .map((e) => (
                  <li key={e.id}>
                    <span className="text-zinc-500">{e.when}</span> · {e.text}
                  </li>
                ))}
            </ul>
          )}
      </Section>
    </div>
  );
}
