import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/session";
import { getPost } from "@/modules/community/showcase";
import { updatePostAction } from "../../../actions";
import { PostForm } from "../../post-form";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { member } = await requireMember();
  const found = await getPost((await params).id, member);
  if (!found || !found.self) notFound();
  const p = found.post;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Showcase" title={`Edit ${p.title}`} description="Screenshots are managed on the project page." />
      <PostForm
        action={updatePostAction.bind(null, p.id)}
        authorName={member.name}
        withScreenshot={false}
        submitLabel="Save changes"
        defaults={{
          title: p.title,
          pitch: p.pitch,
          audience: p.audience,
          builtWith: p.builtWith,
          aiBuilt: p.aiBuilt,
          liveUrl: p.liveUrl,
          repoUrl: p.repoUrl,
          videoUrl: p.videoUrl,
          feedbackAreas: p.feedbackAreas,
          feedbackWanted: p.feedbackWanted,
          stuckOn: p.stuckOn,
          needs: p.needs,
          visibility: p.visibility,
        }}
      />
    </div>
  );
}
