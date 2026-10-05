import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/badges";
import { Callout, Card, PageHeader } from "@/components/ui";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { adjustmentTypeLabel, describeAuditAction, paymentMethodLabel, payoutStatusLabel, projectStatusLabel } from "@/lib/labels";
import { formatMoney, formatPercent } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { getProjectStatement } from "@/modules/reports/statement";

export default async function ProjectStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const st = await getProjectStatement(actor, id);
  if (!st) notFound();
  const { project } = st;
  const money = (m: number) => formatMoney(m, project.currency);
  const failed = st.checks.filter((c) => !c.ok);

  return (
    <div className="mx-auto max-w-4xl space-y-6 print:max-w-none">
      <Link href={`/projects/${project.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg print:hidden">
        <ArrowLeft className="size-4" aria-hidden /> Project
      </Link>
      <PageHeader
        eyebrow="Statement"
        title={
          <>
            <span className="font-mono text-lg text-muted">{project.code}</span> {project.name}
          </>
        }
        description={
          <>
            Status {projectStatusLabel[project.status]} · current value {money(project.totalValueMinor)} · printed {formatDateTime(new Date())}
          </>
        }
      />

      <Callout tone={failed.length ? "bad" : st.checks.length ? "good" : "info"} icon={failed.length ? TriangleAlert : CircleCheck}>
        {st.checks.length === 0
          ? "No approvals yet, so there are no amounts to check."
          : failed.length === 0
            ? `All ${st.checks.length} arithmetic checks pass: every amount below is explained.`
            : `${failed.length} of ${st.checks.length} checks FAIL. Report this to an Admin.`}
        {failed.length > 0 && (
          <ul className="mt-1 list-disc pl-5">
            {failed.map((c) => (
              <li key={c.label}>
                {c.label} ({c.detail})
              </li>
            ))}
          </ul>
        )}
      </Callout>

      {st.snapshots.length === 0 && <p className="text-sm text-muted">This project has not been approved yet.</p>}

      {st.snapshots.map(({ snapshot, approverName, recipients, allocatedMinor }) => (
        <Card
          key={snapshot.id}
          title={`Approval snapshot ${snapshot.sequence}`}
          description={`${formatDateTime(snapshot.createdAt)} by ${approverName}`}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Value {money(snapshot.projectTotalValueMinor)} · {snapshot.splitMode === "PERCENTAGE" ? "percentage" : "fixed-amount"} split ·
              allocated {money(allocatedMinor)}
              {snapshot.calculationNotes && <> · {snapshot.calculationNotes}</>}
            </p>
            {recipients.map(({ line, memberName, entry, payments, adjustments, balance }) => (
              <div key={line.id} className="break-inside-avoid rounded-lg border border-line p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    <span className="font-medium">{memberName}</span> <span className="text-muted">· {line.roleOnProject}</span>
                  </p>
                  {entry ? (
                    <Badge tone={entry.status === "PAID" ? "green" : entry.status === "VOIDED" ? "gray" : "amber"}>{payoutStatusLabel[entry.status]}</Badge>
                  ) : (
                    <span className="text-xs text-muted">No payout (zero amount)</span>
                  )}
                </div>
                <table className="mt-3 w-full tabular-nums">
                  <tbody className="divide-y divide-line">
                    <tr>
                      <td className="py-1.5">
                        Approved share ({line.splitType === "PERCENTAGE" ? formatPercent(line.splitBasisPoints ?? 0) : "fixed"})
                      </td>
                      <td className="py-1.5 text-right">{money(line.amountOwedMinor)}</td>
                    </tr>
                    {adjustments.map((a) => (
                      <tr key={a.id}>
                        <td className="py-1.5">
                          {adjustmentTypeLabel[a.type]} on {formatCalendarDate(a.createdAt.toISOString().slice(0, 10))}:{" "}
                          <span className="text-muted">“{a.reason}”</span>
                        </td>
                        <td className="py-1.5 text-right">{a.type === "VOID" ? "void" : `${a.type === "INCREASE" ? "+" : "−"}${money(a.amountMinor)}`}</td>
                      </tr>
                    ))}
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-1.5">
                          Paid {formatCalendarDate(p.paidAt.toISOString().slice(0, 10))} by {paymentMethodLabel[p.method]}
                          {p.reference && <span className="text-muted">, ref {p.reference}</span>}
                        </td>
                        <td className="py-1.5 text-right text-emerald-700 dark:text-emerald-400">−{money(p.amountMinor)}</td>
                      </tr>
                    ))}
                    {balance && (
                      <tr className="font-semibold">
                        <td className="pt-2">Remaining</td>
                        <td className="pt-2 text-right">{money(balance.remainingMinor)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {entry?.notes && <p className="mt-2 text-xs text-muted">{entry.notes}</p>}
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Card title="Status timeline">
        {st.timeline.length === 0 ? (
          <p className="text-sm text-muted">No project history visible to you.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-5 text-sm">
            {st.timeline.map((e) => {
              const before = (e.beforeJson as { status?: string } | null)?.status;
              const after = (e.afterJson as { status?: string } | null)?.status;
              return (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-line-strong ring-4 ring-surface" aria-hidden />
                  <p>
                    <span className="font-medium">{e.actorName ?? "System"}</span> <span className="text-muted">{describeAuditAction(e.action)}</span>
                    {before && after && before !== after && (
                      <span className="text-muted">
                        {" "}
                        ({before} → {after})
                      </span>
                    )}
                    {e.reason && <span> — “{e.reason}”</span>}
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(e.createdAt)}</p>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
