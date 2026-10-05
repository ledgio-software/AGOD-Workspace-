import Link from "next/link";
import { notFound } from "next/navigation";
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
    <div className="max-w-4xl space-y-6 print:max-w-none">
      <div>
        <Link href={`/projects/${project.id}`} className="text-sm text-zinc-500 hover:underline print:hidden">
          ← Project
        </Link>
        <h1 className="text-xl font-semibold">Statement: {project.code} {project.name}</h1>
        <p className="text-sm text-zinc-500">
          Status {projectStatusLabel[project.status]} · current value {money(project.totalValueMinor)} · printed{" "}
          {formatDateTime(new Date())}
        </p>
      </div>

      <section className={`rounded-md p-3 text-sm ${failed.length ? "bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200" : "bg-green-50 text-green-900 dark:bg-green-950/30 dark:text-green-200"}`}>
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
      </section>

      {st.snapshots.length === 0 && <p className="text-sm text-zinc-500">This project has not been approved yet.</p>}

      {st.snapshots.map(({ snapshot, approverName, recipients, allocatedMinor }) => (
        <section key={snapshot.id} className="space-y-3">
          <h2 className="font-semibold">
            Approval snapshot {snapshot.sequence} · {formatDateTime(snapshot.createdAt)} by {approverName}
          </h2>
          <p className="text-sm">
            Value {money(snapshot.projectTotalValueMinor)} · {snapshot.splitMode === "PERCENTAGE" ? "percentage" : "fixed-amount"} split ·
            allocated {money(allocatedMinor)}
            {snapshot.calculationNotes && <span className="text-zinc-500"> · {snapshot.calculationNotes}</span>}
          </p>
          {recipients.map(({ line, memberName, entry, payments, adjustments, balance }) => (
            <div key={line.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>
                  {memberName} · {line.roleOnProject}
                </strong>
                <span>{entry ? payoutStatusLabel[entry.status] : "No payout (zero amount)"}</span>
              </div>
              <table className="mt-2 w-full tabular-nums">
                <tbody>
                  <tr>
                    <td className="py-0.5">
                      Approved share ({line.splitType === "PERCENTAGE" ? formatPercent(line.splitBasisPoints ?? 0) : "fixed"})
                    </td>
                    <td className="text-right">{money(line.amountOwedMinor)}</td>
                  </tr>
                  {adjustments.map((a) => (
                    <tr key={a.id}>
                      <td className="py-0.5">
                        {adjustmentTypeLabel[a.type]} on {formatCalendarDate(a.createdAt.toISOString().slice(0, 10))}: “{a.reason}”
                      </td>
                      <td className="text-right">
                        {a.type === "VOID" ? "void" : `${a.type === "INCREASE" ? "+" : "−"}${money(a.amountMinor)}`}
                      </td>
                    </tr>
                  ))}
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-0.5">
                        Paid {formatCalendarDate(p.paidAt.toISOString().slice(0, 10))} by {paymentMethodLabel[p.method]}
                        {p.reference && `, ref ${p.reference}`}
                      </td>
                      <td className="text-right">−{money(p.amountMinor)}</td>
                    </tr>
                  ))}
                  {balance && (
                    <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-800">
                      <td className="py-0.5">Remaining</td>
                      <td className="text-right">{money(balance.remainingMinor)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {entry?.notes && <p className="mt-1 text-xs text-zinc-500">{entry.notes}</p>}
            </div>
          ))}
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="font-semibold">Status timeline</h2>
        {st.timeline.length === 0 ? (
          <p className="text-sm text-zinc-500">No project history visible to you.</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {st.timeline.map((e) => {
              const before = (e.beforeJson as { status?: string } | null)?.status;
              const after = (e.afterJson as { status?: string } | null)?.status;
              return (
                <li key={e.id}>
                  <span className="text-zinc-500">{formatDateTime(e.createdAt)}</span> · <strong>{e.actorName ?? "System"}</strong>{" "}
                  {describeAuditAction(e.action)}
                  {before && after && before !== after && (
                    <span className="text-zinc-500">
                      {" "}
                      ({before} → {after})
                    </span>
                  )}
                  {e.reason && <span> — “{e.reason}”</span>}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
