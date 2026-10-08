import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Callout, Card, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/session";
import { ensureProfile } from "@/modules/community";
import { coversAvailable } from "@/modules/community/articles";
import { createArticleAction } from "../../article-actions";
import { ArticleEditor } from "../../article-forms";

export default async function NewArticlePage() {
  const { member } = await requireMember();
  const profile = await ensureProfile(member);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/community/articles" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> My articles
      </Link>
      <PageHeader title="Write an article" description="Save it as a draft while you work. When you publish, everyone can read it, even without an account." />
      {profile.conductAcceptedAt ? (
        <Card>
          <ArticleEditor action={createArticleAction} published={false} coversOn={coversAvailable()} hasCover={false} />
        </Card>
      ) : (
        <Callout tone="info">
          Agree to the code of conduct on the <Link href="/community" className="font-medium underline">community home</Link> first.
        </Callout>
      )}
    </div>
  );
}
