import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/session";
import { getItem } from "@/modules/community/library";
import { updateItemAction } from "../../../growth-actions";
import { LibraryItemForm } from "../../../growth-forms";

export default async function EditLibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { member } = await requireMember();
  const { id } = await params;
  const item = await getItem(member, id);
  if (!item || item.authorId !== member.id) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/library/${item.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {item.title}
      </Link>
      <PageHeader title="Edit" />
      <Card>
        <LibraryItemForm
          action={updateItemAction.bind(null, item.id)}
          submitLabel="Save"
          defaults={{ kind: item.kind, title: item.title, summary: item.summary, url: item.url ?? "", body: item.body ?? "", tags: item.tags.join(", "), lowData: item.lowData, free: item.free }}
        />
      </Card>
    </div>
  );
}
