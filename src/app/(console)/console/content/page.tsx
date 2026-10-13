import Link from "next/link";
import { ImagePlay, Star } from "lucide-react";
import { buttonClass, Card, PageHeader, cx, table } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { frontPage } from "@/modules/community/front";
import { listItems } from "@/modules/community/library";
import { NEWS_TOPICS, newsSourceStatus } from "@/modules/community/news";
import { ButtonForm } from "../../../(community)/community/growth-forms";
import { newsSourceAction, refreshNewsAction } from "../../../(community)/community/news-actions";

export const metadata = { title: "Content" };

// Phase 40: what the community shows on its own: tech news sources, the front page, and featured
// tools & prompts.

export default async function ConsoleContent() {
  const me = (await getSignedIn())!;
  const [sources, front, items] = await Promise.all([newsSourceStatus(me), frontPage(), listItems(me)]);
  const featured = items.filter((i) => i.featured);
  const failing = sources.filter((s) => s.enabled && s.lastError).length;

  return (
    <>
      <PageHeader title="Content" description="The parts of the site that aren't written by members: the news feed, the front page and featured tools." />

      <Card
        title={`Tech news sources${failing ? ` · ${failing} failing` : ""}`}
        description="Fetched every few hours when someone opens /news, and by the daily job. Switch a source off to stop fetching it and hide its headlines. Adding one is a small code change (src/modules/community/news.ts)."
      >
        <div className="mb-4">
          <ButtonForm action={refreshNewsAction} label="Fetch all now" variant="primary" />
        </div>
        <div className={table.wrap}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Source</th>
                <th className={table.th}>Topic</th>
                <th className={cx(table.th, "text-right")}>Headlines</th>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Front page" description="The photos behind the welcome text and the welcome video, on the home page and the community home.">
          <p className="mb-4 text-sm text-muted">
            {front.photos.length} {front.photos.length === 1 ? "photo" : "photos"} · {front.video ? `video: ${front.video.title ?? front.video.url}` : "no video"}
          </p>
          <Link href="/community/front-page" className={buttonClass("secondary")}>
            <ImagePlay className="size-4" aria-hidden /> Change photos and video
          </Link>
        </Card>
        <Card title={`Featured tools & prompts · ${featured.length}`} description="Shown first in the library. Feature or unfeature one on its own page.">
          {featured.length === 0 ? (
            <p className="text-sm text-muted">Nothing featured.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {featured.map((i) => (
                <li key={i.id}>
                  <Link href={`/library/${i.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Star className="size-3.5 text-amber-500" aria-hidden /> {i.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/library" className={cx(buttonClass("secondary"), "mt-4")}>
            Open the library
          </Link>
        </Card>
      </div>
    </>
  );
}
