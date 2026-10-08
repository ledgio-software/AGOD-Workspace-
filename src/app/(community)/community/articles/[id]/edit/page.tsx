import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Callout, Card, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/session";
import { coversAvailable, getArticle } from "@/modules/community/articles";
import { publishAction, updateArticleAction } from "../../../article-actions";
import { ArticleEditor } from "../../../article-forms";
import { ButtonForm } from "../../../growth-forms";

export default async function EditArticlePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; problem?: string }> }) {
  const { member } = await requireMember();
  const { id } = await params;
  const { saved, problem } = await searchParams;
  const a = await getArticle(member, id);
  if (!a || !a.mine) notFound();
  const published = a.status === "PUBLISHED";
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/community/articles" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> My articles
      </Link>
      <PageHeader
        title={published ? "Edit article" : "Edit draft"}
        actions={
          <>
            <Link href={`/articles/${a.id}`} className="text-sm text-brand-600 hover:underline dark:text-brand-400">
              {published ? "See it" : "See how it looks"}
            </Link>
            {published && !a.hidden && <ButtonForm action={publishAction.bind(null, a.id, false)} label="Back to draft" confirmMessage="Take it off the feed? Only you will see it until you publish it again." />}
          </>
        }
      />
      {problem && <Callout tone="warn">Your draft was saved, but: {problem.slice(0, 300)}</Callout>}
      {saved && !problem && <Callout tone="good">Draft saved. Only you can see it until you publish it.</Callout>}
      {a.hidden && <Callout tone="warn">The organizers hid this article after a report, so it can&apos;t be published again.</Callout>}
      <Card>
        <ArticleEditor
          action={updateArticleAction.bind(null, a.id)}
          published={published}
          coversOn={coversAvailable()}
          hasCover={a.hasCover}
          defaults={{ title: a.title, summary: a.summary, body: a.body, tags: a.tags.join(", ") }}
        />
      </Card>
    </div>
  );
}
