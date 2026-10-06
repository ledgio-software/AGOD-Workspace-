import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/badges";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getOrganization } from "@/modules/orgs";
import { moneyFlowAction, selfApprovalAction, updateCompanyAction } from "./actions";
import { CompanyForm, MoneyFlowForm, SelfApprovalForm } from "./company-form";

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
      <Card title="Client payments" description="Deposits, how long clients have to review work, and when the team can be paid.">
        <MoneyFlowForm
          action={moneyFlowAction}
          defaults={{
            defaultDeposit: String(org.defaultDepositBasisPoints / 100),
            requireDeposit: org.requireDeposit,
            clientReviewDays: org.clientReviewDays,
            payoutRelease: org.payoutRelease as "ON_APPROVAL" | "ON_CLIENT_PAYMENT",
          }}
        />
      </Card>
      <Card
        title="Two people for money"
        aside={org.allowSelfApproval ? <Badge tone="amber">Off: one person may do it all</Badge> : <Badge tone="green">On</Badge>}
      >
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            When this is on, nobody can approve a project they are paid on or asked to have approved, and nobody can record a payment or
            adjustment on their own payout. Someone else has to check it. This protects both the company and the team.
          </p>
          {org.allowSelfApproval && (
            <p className="text-amber-700 dark:text-amber-400">
              It is off: one person can approve and pay their own work. Turn it on as soon as you have a second manager or Admin.
            </p>
          )}
          <SelfApprovalForm action={selfApprovalAction} allow={org.allowSelfApproval} />
        </div>
      </Card>
    </div>
  );
}
