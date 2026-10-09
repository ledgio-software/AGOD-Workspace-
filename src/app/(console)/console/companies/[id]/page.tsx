import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Callout, Card, PageHeader, StatCard, cx, table } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { roleLabel } from "@/lib/labels";
import { getSignedIn } from "@/lib/session";
import { getCompany } from "@/modules/platform";
import { suspendCompanyAction } from "../../actions";
import { ReasonForm } from "../../forms";
import { AuditList } from "../../audit-list";

export const metadata = { title: "Company" };

// Phase 40: one company's summary (no projects, clients or money), its people, and suspension.

export default async function ConsoleCompany({ params }: { params: Promise<{ id: string }> }) {
  const me = (await getSignedIn())!;
  const found = await getCompany(me, (await params).id);
  if (!found) notFound();
  const { company: c, members, log } = found;

  return (
    <>
      <Link href="/console/companies" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Companies
      </Link>
      <PageHeader eyebrow={c.slug} title={c.name} description={`Created ${formatDate(c.createdAt)}. ${c.lastActivity ? `Last used ${formatDateTime(c.lastActivity)}.` : "Not used yet."}`} />
      {c.suspendedAt && (
        <Callout tone="bad">
          <strong>Suspended on {formatDateTime(c.suspendedAt)}.</strong> Reason: {c.suspendedReason}. Its members can&apos;t open it; they keep the community. Nothing has been deleted.
        </Callout>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active people" value={c.members} />
        <StatCard label="Admins" value={c.admins} />
        <StatCard label="Projects" value={c.projects} />
        <StatCard label="Kind" value={c.teamType === "FINTECH" ? "Fintech" : c.teamType === "SOFTWARE" ? "Software" : "Other"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="People" description="Their role in this company. Open someone to block their login or send a password link.">
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Name</th>
                  <th className={table.th}>Role</th>
                  <th className={table.th}>Joined</th>
                  <th className={table.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId} className={cx(table.row, !m.active && "opacity-60")}>
                    <td className={table.td}>
                      <Link href={`/console/people/${m.userId}`} className="font-medium hover:underline">
                        {m.name}
                      </Link>
                      <div className="text-xs text-muted">{m.email}</div>
                    </td>
                    <td className={table.td}>{roleLabel[m.role as keyof typeof roleLabel] ?? m.role}</td>
                    <td className={table.td}>{formatDate(m.joinedAt)}</td>
                    <td className={table.td}>{!m.loginActive ? "Login blocked" : m.active ? "Active" : "Removed from company"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-6">
          <Card title={c.suspendedAt ? "Restore the company" : "Suspend the company"} description={c.suspendedAt ? "Its members can open it again, with everything as it was." : "Its members lose access to it (they keep the community) and it gets no reminders or emails. Nothing is deleted; you can restore it any time."}>
            <ReasonForm
              action={suspendCompanyAction.bind(null, c.id, !c.suspendedAt)}
              label={c.suspendedAt ? "Restore" : "Suspend"}
              danger={!c.suspendedAt}
              confirmMessage={c.suspendedAt ? `Restore ${c.name}?` : `Suspend ${c.name}? Its ${c.members} people lose access right away.`}
              placeholder={c.suspendedAt ? "e.g. Fees paid" : "e.g. Unpaid fees, or the owner asked"}
            />
          </Card>
          <Card title="Back-office log">
            <AuditList rows={log} empty="No back-office actions on this company yet." />
          </Card>
        </div>
      </div>
    </>
  );
}
