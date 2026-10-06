import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listCustomerOptions } from "@/modules/customers";
import { listActiveMembers } from "@/modules/projects";
import { createProjectAction } from "../actions";
import { ProjectForm } from "../project-form";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "project.create")) return <AccessDenied what="creating projects" />;
  const members = await listActiveMembers(actor);
  // Phase 28: a company role may run projects without seeing the customer list.
  const customers = can(actor, "customer.view") ? await listCustomerOptions(actor) : [];
  // Coming from a customer's page: start as an external project for that customer.
  const { customer } = await searchParams;
  const preset = customers.find((c) => c.id === customer);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Projects
      </Link>
      <PageHeader
        title="New project"
        description="The project starts as a draft. Add the team, splits and tasks next. A project code is assigned automatically."
      />
      <Card>
        <ProjectForm
          action={createProjectAction}
          members={members}
          customers={customers}
          defaults={{ projectOwnerId: actor.id, ...(preset ? { clientType: "EXTERNAL", customerId: preset.id } : {}) }}
          submitLabel="Create project"
        />
      </Card>
    </div>
  );
}
