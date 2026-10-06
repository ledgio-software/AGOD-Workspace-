import { AccessDenied } from "@/components/access-denied";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getOrganization } from "@/modules/orgs";
import { updateCompanyAction } from "./actions";
import { CompanyForm } from "./company-form";

export default async function CompanyPage() {
  const actor = await requireUser();
  if (!can(actor, "company.manage")) return <AccessDenied what="company settings" />;
  const org = await getOrganization(actor);
  if (!org) return <AccessDenied what="company settings" />;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Team & admin"
        title="Company"
        description="Your company's name and how its projects are numbered. Everything in this workspace belongs to this company and is never visible to other companies."
      />
      <Card>
        <CompanyForm action={updateCompanyAction} defaults={{ name: org.name, projectCodePrefix: org.projectCodePrefix }} />
      </Card>
    </div>
  );
}
