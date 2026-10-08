import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Callout, Card, PageHeader } from "@/components/ui";
import { todayInOperatingZone } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { ensureProfile } from "@/modules/community";
import { MAX_DAYS_OPEN } from "@/modules/community/jobs";
import { addDays } from "@/modules/notifications/deadlines";
import { createJobAction } from "../../work-actions";
import { JobForm } from "../../work-forms";

export default async function NewJobPage() {
  const { member } = await requireMember();
  const profile = await ensureProfile(member);
  const today = todayInOperatingZone();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/jobs" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Jobs &amp; gigs
      </Link>
      <PageHeader title="Post a job or a gig" description="Members apply with a short message and their profile. You get an email for each application." />
      {profile.conductAcceptedAt ? (
        <Card>
          <JobForm
            action={createJobAction}
            submitLabel="Post"
            minDate={today}
            maxDate={addDays(today, MAX_DAYS_OPEN)}
            defaults={{ hirer: "", title: "", kind: "GIG", workMode: "REMOTE", location: "", payMin: "", payMax: "", payUnit: "", description: "", skills: "", closesOn: addDays(today, 14) }}
          />
        </Card>
      ) : (
        <Callout tone="info">
          Agree to the code of conduct on the <Link href="/community" className="font-medium underline">community home</Link> first.
        </Callout>
      )}
    </div>
  );
}
