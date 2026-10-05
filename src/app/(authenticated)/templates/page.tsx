import Link from "next/link";
import { LayoutTemplate, Plus } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/badges";
import { Card, Disclosure, EmptyState, PageHeader, table } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listTemplates } from "@/modules/templates";
import { createTemplateAction } from "./actions";
import { TemplateForm } from "./template-form";

export default async function TemplatesPage() {
  const actor = await requireUser();
  if (!can(actor, "template.manage")) return <AccessDenied what="templates" />;
  const templates = await listTemplates(actor, { includeInactive: true });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Work"
        title="Project templates"
        description="Reusable milestones and tasks for common project types. Apply one from a project's Tasks tab; tasks are added unassigned."
      />
      <Card bodyClassName="p-0">
        {templates.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={LayoutTemplate} title="No templates yet" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Template</th>
                  <th className={`${table.th} text-right`}>Milestones</th>
                  <th className={`${table.th} text-right`}>Tasks</th>
                  <th className={`${table.th} text-right`}>Estimated hours</th>
                  <th className={table.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className={`${table.row} align-top`}>
                    <td className={`${table.td} min-w-64`}>
                      <Link href={`/templates/${t.id}`} className="inline-flex items-center gap-2 font-medium hover:text-brand-600">
                        <LayoutTemplate className="size-4 text-muted" aria-hidden />
                        {t.name}
                      </Link>
                      {t.description && <div className="mt-0.5 text-xs text-muted">{t.description}</div>}
                    </td>
                    <td className={table.num}>{t.counts.milestones}</td>
                    <td className={table.num}>{t.counts.tasks}</td>
                    <td className={table.num}>{t.counts.hours}h</td>
                    <td className={table.td}>
                      <Badge tone={t.active ? "green" : "gray"}>{t.active ? "Active" : "Inactive"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Disclosure
        className="bg-surface shadow-xs"
        summary={
          <span className="inline-flex items-center gap-2">
            <Plus className="size-4 text-brand-600" aria-hidden /> New template
          </span>
        }
      >
        <TemplateForm action={createTemplateAction} submitLabel="Create template" />
      </Disclosure>
    </div>
  );
}
