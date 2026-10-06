import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Star, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/badges";
import { Callout, Card, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { canModerate } from "@/modules/community";
import { LIBRARY_KINDS, getItem } from "@/modules/community/library";
import { ReportForm } from "../../../(community)/community/forms";
import { featureItemAction, removeItemAction, reportItemAction, unhideItemAction, usefulAction } from "../../../(community)/community/growth-actions";
import { ButtonForm, CopyButton } from "../../../(community)/community/growth-forms";

export const metadata: Metadata = { title: "Tools & prompts" };

export default async function LibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getSignedIn();
  const { id } = await params;
  const item = await getItem(viewer, id);
  if (!item) notFound();
  const mine = viewer?.id === item.authorId;
  const organizer = viewer ? await canModerate(viewer) : false;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/library" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Tools &amp; prompts
      </Link>
      {item.hidden && <Callout tone="warn">Hidden by the organizers after a report. Only you and the organizers can see it.</Callout>}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={item.kind === "PROMPT" ? "violet" : item.kind === "TOOL" ? "blue" : "green"}>{LIBRARY_KINDS[item.kind]}</Badge>
          {item.featured && (
            <Badge tone="amber">
              <Star className="mr-1 inline size-3" aria-hidden />
              Featured
            </Badge>
          )}
          {item.lowData && <Badge>Works on slow internet</Badge>}
          {item.free && <Badge>Free</Badge>}
          {item.tags.map((t) => (
            <Link key={t} href={`/library?tag=${encodeURIComponent(t)}`} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted hover:text-fg">
              {t}
            </Link>
          ))}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{item.title}</h1>
        <p className="text-muted">{item.summary}</p>
        <p className="text-xs text-muted">
          Shared by{" "}
          {item.authorHandle ? (
            <Link href={`/members/${item.authorHandle}`} className="hover:underline">
              {item.authorName}
            </Link>
          ) : (
            item.authorName
          )}{" "}
          on {formatDate(item.createdAt)}
        </p>
      </div>

      {item.body && (
        <Card title="The prompt" aside={<CopyButton text={item.body} />}>
          <pre className="whitespace-pre-wrap break-words font-mono text-sm">{item.body}</pre>
        </Card>
      )}
      {item.url && (
        <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className={buttonClass("primary")}>
          Open {item.kind === "TOOL" ? "the tool" : "the guide"} <ExternalLink className="size-4" aria-hidden />
        </a>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {viewer && !mine ? (
          <ButtonForm
            action={usefulAction.bind(null, item.id)}
            variant={item.markedByMe ? "primary" : "secondary"}
            label={
              <>
                <ThumbsUp className="size-4" aria-hidden /> {item.markedByMe ? "Useful to you" : "Mark as useful"} · {item.useful}
              </>
            }
          />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            <ThumbsUp className="size-4" aria-hidden /> {item.useful} found this useful
          </span>
        )}
        {mine && (
          <>
            <Link href={`/community/library/${item.id}/edit`} className={buttonClass("secondary", "sm")}>
              Edit
            </Link>
            <ButtonForm action={removeItemAction.bind(null, item.id)} label="Remove" confirmMessage="Remove this from the library?" variant="danger" />
          </>
        )}
        {organizer && !item.hidden && <ButtonForm action={featureItemAction.bind(null, item.id, !item.featured)} label={item.featured ? "Stop featuring" : "Feature"} />}
        {organizer && item.hidden && <ButtonForm action={unhideItemAction.bind(null, item.id)} label="Show again" />}
      </div>
      {viewer && !mine && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-fg">Report this</summary>
          <div className="mt-2">
            <ReportForm action={reportItemAction.bind(null, item.id)} />
          </div>
        </details>
      )}
    </div>
  );
}
