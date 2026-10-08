import Link from "next/link";
import { Bookmark, Newspaper } from "lucide-react";
import { Badge } from "@/components/badges";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { myArticles } from "@/modules/community/articles";
import { ArticleCard } from "../../../(public)/articles/article-card";

// Phase 37: my drafts and published articles, and my reading list.

export default async function MyArticlesPage() {
  const { member } = await requireMember();
  const { written, bookmarks } = await myArticles(member);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Community"
        title="My articles"
        description="Your drafts and published articles, and the articles you saved for later."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/articles" className={buttonClass("secondary")}>
              Read articles
            </Link>
            <Link href="/community/articles/new" className={buttonClass("primary")}>
              Write an article
            </Link>
          </div>
        }
      />

      <Card title="Written by me">
        {written.length === 0 ? (
          <EmptyState icon={Newspaper} title="You haven't written an article">
            Write about something you built, a mistake you fixed, or a tool you like. Others learn from it.
          </EmptyState>
        ) : (
          <ul className="-my-2 divide-y divide-line">
            {written.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/articles/${a.id}`} className="font-medium hover:underline">
                      {a.title}
                    </Link>
                    {a.hidden ? <Badge tone="red">Hidden</Badge> : a.status === "PUBLISHED" ? <Badge tone="green">Published</Badge> : <Badge>Draft</Badge>}
                  </div>
                  <p className="text-xs text-muted">
                    {a.publishedAt ? `Published ${formatDate(a.publishedAt)} · ` : ""}
                    {a.useful} useful · {a.comments} comments{a.reviews > 0 ? ` · reviewed` : ""}
                  </p>
                </div>
                <Link href={`/community/articles/${a.id}/edit`} className={buttonClass("secondary", "sm")}>
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Bookmark className="size-5" aria-hidden /> Saved for later
        </h2>
        {bookmarks.length === 0 ? (
          <p className="text-sm text-muted">Press &ldquo;Save for later&rdquo; on an article to keep it here.</p>
        ) : (
          <ul className="space-y-4">
            {bookmarks.map((a) => (
              <li key={a.id}>
                <ArticleCard article={a} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
