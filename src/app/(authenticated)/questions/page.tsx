import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { QuestionStatusBadge } from "@/components/badges";
import { Avatar, Card, EmptyState, PageHeader, TabNav, table } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listQuestions } from "@/modules/questions";

const tabs = [
  { status: "OPEN", label: "Waiting for PM review" },
  { status: "AWAITING_ADMIN", label: "Waiting for Admin" },
  { status: "RESOLVED", label: "Resolved" },
  { status: "", label: "All" },
] as const;

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "payoutQuestion.review")) return <AccessDenied what="payout questions" />;
  const { status = "OPEN" } = await searchParams;
  const questions = await listQuestions(actor, { status: (status || undefined) as "OPEN" | undefined });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Money"
        title="Payout questions"
        description="Members ask about a payout without changing it. A PM answers or sends it to an Admin, who records any adjustment."
      />
      <TabNav label="Question status" items={tabs.map((t) => ({ href: `/questions?status=${t.status}`, label: t.label, active: status === t.status }))} />
      <Card bodyClassName="p-0">
        {questions.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={CircleHelp} title="No questions here" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Question</th>
                  <th className={table.th}>Member</th>
                  <th className={table.th}>Project</th>
                  <th className={table.th}>Asked</th>
                  <th className={table.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q) => (
                  <tr key={q.id} className={`${table.row} align-top`}>
                    <td className={`${table.td} min-w-72`}>
                      <Link href={`/payouts/${q.ledgerEntryId}#questions`} className="font-medium hover:text-brand-600">
                        {q.question.length > 140 ? `${q.question.slice(0, 140)}…` : q.question}
                      </Link>
                    </td>
                    <td className={table.td}>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <Avatar name={q.raisedByName} size="sm" />
                        {q.raisedByName}
                      </span>
                    </td>
                    <td className={`${table.td} font-mono text-xs`}>{q.projectCode}</td>
                    <td className={`${table.td} whitespace-nowrap text-muted`}>{formatDateTime(q.createdAt)}</td>
                    <td className={table.td}>
                      <QuestionStatusBadge status={q.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
