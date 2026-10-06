import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getTemplate } from "@/modules/templates";
import { updateTemplateAction } from "../actions";
import { TemplateForm } from "../template-form";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "template.manage")) return <AccessDenied what="templates" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const template = await getTemplate(actor, id);
  if (!template) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/templates" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Templates
      </Link>
      <PageHeader eyebrow="Template" title={template.name} />
      <Card>
        <TemplateForm action={updateTemplateAction.bind(null, template.id)} defaults={template} submitLabel="Save template" />
      </Card>
    </div>
  );
}
