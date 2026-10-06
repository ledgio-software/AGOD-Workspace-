import Link from "next/link";
import { HandHeart } from "lucide-react";
import { Callout, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/session";
import { ensureProfile } from "@/modules/community";
import { giveBack, screenshotsAvailable } from "@/modules/community/showcase";
import { createPostAction } from "../../actions";
import { EMPTY_POST, PostForm } from "../post-form";

export default async function NewPostPage() {
  const { member } = await requireMember();
  const [profile, counts] = await Promise.all([ensureProfile(member), giveBack(member.id)]);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Showcase"
        title="Share a project"
        description="Finished or in progress. Posts with a link, a screenshot or a short video demo get the most useful feedback."
      />
      {!profile.conductAcceptedAt ? (
        <Callout tone="warn">
          Agree to the code of conduct on the{" "}
          <Link href="/community" className="font-medium underline">
            community home
          </Link>{" "}
          before you post.
        </Callout>
      ) : (
        <>
          {counts.posts > counts.reviews && (
            <Callout tone="info" icon={HandHeart}>
              You have shared {counts.posts} {counts.posts === 1 ? "project" : "projects"} and reviewed {counts.reviews}. The community asks for one review for every
              project you post:{" "}
              <Link href="/showcase?status=NEEDS_REVIEW" className="font-medium underline">
                see who is waiting for feedback
              </Link>
              .
            </Callout>
          )}
          <PostForm action={createPostAction} defaults={EMPTY_POST} authorName={member.name} withScreenshot={screenshotsAvailable()} submitLabel="Share project" />
        </>
      )}
    </div>
  );
}
