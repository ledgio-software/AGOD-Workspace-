import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
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
    <div className="max-w-4xl space-y-4">
      <Link href="/templates" className="text-sm text-zinc-500 hover:underline">
        ← Templates
      </Link>
      <h1 className="text-xl font-semibold">{template.name}</h1>
      <TemplateForm action={updateTemplateAction.bind(null, template.id)} defaults={template} submitLabel="Save template" />
    </div>
  );
}
