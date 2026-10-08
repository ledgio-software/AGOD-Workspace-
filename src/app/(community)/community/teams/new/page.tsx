import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Callout, Card, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/session";
import { ensureProfile } from "@/modules/community";
import { createTeamPostAction } from "../../work-actions";
import { TeamPostForm } from "../../work-forms";

export default async function NewTeamPostPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { member } = await requireMember();
  const profile = await ensureProfile(member);
  const kind = (await searchParams).kind === "JOINING" ? "JOINING" : "IDEA";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/teams" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Team finder
      </Link>
      <PageHeader title="Post on the team finder" description="Find people to build with. You can have 3 open posts at a time." />
      {profile.conductAcceptedAt ? (
        <Card>
          <TeamPostForm
            action={createTeamPostAction}
            submitLabel="Post"
            defaults={{ kind, title: "", description: "", roles: "", tools: (profile.tools ?? []).join(", "), commitment: "", reward: "LEARNING" }}
          />
        </Card>
      ) : (
        <Callout tone="info">
          Agree to the code of conduct on the <Link href="/community" className="font-medium underline">community home</Link> first.
        </Callout>
      )}
    </div>
  );
}
