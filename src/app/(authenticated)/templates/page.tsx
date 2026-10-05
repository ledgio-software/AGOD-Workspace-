import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
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
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Project templates</h1>
        <p className="text-sm text-zinc-500">
          Reusable milestones and tasks for common project types. Apply one from a project page; tasks are added unassigned.
        </p>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-2 pr-3 font-medium">Template</th>
            <th className="py-2 pr-3 text-right font-medium">Milestones</th>
            <th className="py-2 pr-3 text-right font-medium">Tasks</th>
            <th className="py-2 pr-3 text-right font-medium">Estimated hours</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="border-t border-zinc-100 align-top dark:border-zinc-900">
              <td className="py-2 pr-3">
                <Link href={`/templates/${t.id}`} className="underline">
                  {t.name}
                </Link>
                {t.description && <div className="text-zinc-500">{t.description}</div>}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{t.counts.milestones}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{t.counts.tasks}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{t.counts.hours}</td>
              <td className="py-2">{t.active ? "Active" : <span className="text-zinc-500">Inactive</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <summary className="cursor-pointer font-medium">New template</summary>
        <div className="mt-4">
          <TemplateForm action={createTemplateAction} submitLabel="Create template" />
        </div>
      </details>
    </div>
  );
}
