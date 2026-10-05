import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { formatDateTime } from "@/lib/dates";
import { payoutQuestionStatusLabel } from "@/lib/labels";
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
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Payout questions</h1>
        <p className="text-sm text-zinc-500">
          Members ask about a payout without changing it. A PM answers or sends it to an Admin, who records any adjustment.
        </p>
      </div>
      <nav className="flex flex-wrap gap-2 text-sm">
        {tabs.map((t) => (
          <Link
            key={t.status}
            href={`/questions?status=${t.status}`}
            className={`rounded-md border px-3 py-1 ${status === t.status ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {questions.length === 0 ? (
        <p className="text-sm text-zinc-500">No questions here.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-2 pr-3 font-medium">Asked</th>
              <th className="py-2 pr-3 font-medium">Member</th>
              <th className="py-2 pr-3 font-medium">Project</th>
              <th className="py-2 pr-3 font-medium">Question</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((q) => (
              <tr key={q.id} className="border-t border-zinc-100 align-top dark:border-zinc-900">
                <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(q.createdAt)}</td>
                <td className="py-2 pr-3">{q.raisedByName}</td>
                <td className="py-2 pr-3">{q.projectCode}</td>
                <td className="py-2 pr-3">
                  <Link href={`/payouts/${q.ledgerEntryId}#questions`} className="underline">
                    {q.question.length > 120 ? `${q.question.slice(0, 120)}…` : q.question}
                  </Link>
                </td>
                <td className="py-2">{payoutQuestionStatusLabel[q.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
