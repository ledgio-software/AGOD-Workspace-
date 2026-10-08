import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Callout, Card, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/session";
import { ensureProfile } from "@/modules/community";
import { createItemAction } from "../../growth-actions";
import { LibraryItemForm } from "../../growth-forms";

export default async function NewLibraryItemPage() {
  const { member } = await requireMember();
  const profile = await ensureProfile(member);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/library" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Tools &amp; prompts
      </Link>
      <PageHeader title="Share a tool or a prompt" description="Something that helped you build. Others can mark it useful." />
      {profile.conductAcceptedAt ? (
        <Card>
          <LibraryItemForm action={createItemAction} submitLabel="Share" />
        </Card>
      ) : (
        <Callout tone="info">
          Agree to the code of conduct on the <Link href="/community" className="font-medium underline">community home</Link> first.
        </Callout>
      )}
    </div>
  );
}
