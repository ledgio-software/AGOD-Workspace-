import { Download, Rocket } from "lucide-react";
import { Callout, Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { inputClass } from "@/components/input-class";
import { todayInOperatingZone } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { releaseControlOn, releaseOverview } from "@/modules/releases";
import { ReleaseTable } from "./release-ui";

// Phase 32: every release the person can see; what's waiting first. Admins download the evidence.

export default async function ReleasesPage() {
  const actor = await requireUser();
  const [on, { waiting, recent }] = await Promise.all([releaseControlOn(actor), releaseOverview(actor)]);
  const today = todayInOperatingZone();
  const yearStart = `${today.slice(0, 4)}-01-01`;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Work"
        title="Releases"
        description="Changes going live, with who wrote, checked, approved and deployed each one. Record a new release from its project's Releases tab."
      />
      {!on && (
        <Callout tone="info" icon={Rocket}>
          Release approvals are switched off for this company{can(actor, "company.manage") ? ". Switch them on on the Company page." : "."} Past releases stay here.
        </Callout>
      )}
      <Card title="Waiting" description="Submitted releases, and emergency releases that went live and still need approval." bodyClassName="">
        {waiting.length === 0 ? (
          <div className="px-5 py-4">
            <EmptyState icon={Rocket} title="Nothing waiting" />
          </div>
        ) : (
          <ReleaseTable rows={waiting} showProject />
        )}
      </Card>
      <Card title="Recent" bodyClassName="">
        {recent.length === 0 ? (
          <div className="px-5 py-4">
            <EmptyState icon={Rocket} title="No releases yet">
              Open a project and use its Releases tab.
            </EmptyState>
          </div>
        ) : (
          <ReleaseTable rows={recent} showProject />
        )}
      </Card>
      {can(actor, "audit.viewAll") && (
        <Card title="Evidence for auditors" description="Every release written in these dates, with each step, who did it and when, as a spreadsheet (CSV). The download is recorded in the audit log.">
          <form action="/releases/export" method="get" className="flex flex-wrap items-end gap-3 text-sm">
            <label className="space-y-1.5">
              <span className="block font-medium">From</span>
              <input type="date" name="from" required defaultValue={yearStart} className={inputClass} />
            </label>
            <label className="space-y-1.5">
              <span className="block font-medium">To</span>
              <input type="date" name="to" required defaultValue={today} className={inputClass} />
            </label>
            <button type="submit" className={buttonClass("secondary")}>
              <Download className="size-4" aria-hidden /> Download CSV
            </button>
          </form>
        </Card>
      )}
    </div>
  );
}
