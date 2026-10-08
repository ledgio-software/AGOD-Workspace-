import Link from "next/link";
import { Callout, Card, PageHeader, cx, table } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { canModerate } from "@/modules/community";
import { NEWS_TOPICS, newsSourceStatus } from "@/modules/community/news";
import { ButtonForm } from "../growth-forms";
import { newsSourceAction, refreshNewsAction } from "../news-actions";

// Phase 38: organizers see each news source (when it last worked, how many headlines it has),
// switch sources off or on, and fetch everything now.

export default async function NewsSources() {
  const { member } = await requireMember();
  if (!(await canModerate(member))) {
    return (
      <Callout tone="info">
        Only community organizers can manage news sources. <Link href="/news" className="font-medium underline">Read the news</Link>
      </Callout>
    );
  }
  const sources = await newsSourceStatus(member);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Community"
        title="News sources"
        description="Where the headlines on the news page come from. They're fetched every few hours (when someone opens the page) and once a day by the daily job."
        actions={<ButtonForm action={refreshNewsAction} label="Fetch all now" variant="primary" />}
      />
      <Card title="Sources" description="Switch a source off to stop fetching it and hide its headlines. Adding a source is a small code change in src/modules/community/news.ts.">
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Source</th>
                <th className={table.th}>Topic</th>
                <th className={table.th}>Headlines</th>
                <th className={table.th}>Last worked</th>
                <th className={table.th}></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.key} className={cx(table.row, !s.enabled && "opacity-60")}>
                  <td className={table.td}>
                    <a href={s.site} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                      {s.name}
                    </a>
                    {s.lastError && <p className="mt-1 max-w-xs text-xs text-red-700 dark:text-red-400">Last try failed: {s.lastError}</p>}
                  </td>
                  <td className={table.td}>{NEWS_TOPICS[s.topic]}</td>
                  <td className={table.num}>{s.items}</td>
                  <td className={table.td}>{s.lastOkAt ? formatDateTime(s.lastOkAt) : "Not yet"}</td>
                  <td className={table.td}>
                    <ButtonForm action={newsSourceAction.bind(null, s.key, !s.enabled)} label={s.enabled ? "Switch off" : "Switch on"} variant={s.enabled ? "secondary" : "primary"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
