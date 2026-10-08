import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/session";
import { getTeamPost } from "@/modules/community/teams";
import { updateTeamPostAction } from "../../../work-actions";
import { TeamPostForm } from "../../../work-forms";

export default async function EditTeamPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { member } = await requireMember();
  const { id } = await params;
  const post = await getTeamPost(member, id);
  if (!post || post.authorId !== member.id || post.status !== "OPEN") notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/teams/${post.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {post.title}
      </Link>
      <PageHeader title="Edit post" />
      <Card>
        <TeamPostForm
          action={updateTeamPostAction.bind(null, post.id)}
          submitLabel="Save"
          defaults={{ kind: post.kind, title: post.title, description: post.description, roles: post.roles.join(", "), tools: post.tools.join(", "), commitment: post.commitment, reward: post.reward }}
        />
      </Card>
    </div>
  );
}
