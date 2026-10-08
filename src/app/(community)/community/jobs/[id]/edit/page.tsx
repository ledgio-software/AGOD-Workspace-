import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { todayInOperatingZone } from "@/lib/dates";
import { minorToInput } from "@/lib/money";
import { requireMember } from "@/lib/session";
import { MAX_DAYS_OPEN, getJob } from "@/modules/community/jobs";
import { addDays } from "@/modules/notifications/deadlines";
import { updateJobAction } from "../../../work-actions";
import { JobForm } from "../../../work-forms";

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { member } = await requireMember();
  const { id } = await params;
  const job = await getJob(member, id);
  if (!job || job.posterId !== member.id || job.status !== "OPEN") notFound();
  const today = todayInOperatingZone();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/jobs/${job.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {job.title}
      </Link>
      <PageHeader title="Edit job" />
      <Card>
        <JobForm
          action={updateJobAction.bind(null, job.id)}
          submitLabel="Save"
          minDate={today}
          maxDate={addDays(today, MAX_DAYS_OPEN)}
          defaults={{
            hirer: job.hirer,
            title: job.title,
            kind: job.kind,
            workMode: job.workMode,
            location: job.location ?? "",
            payMin: job.payMinMinor === null ? "" : minorToInput(job.payMinMinor),
            payMax: job.payMaxMinor === null ? "" : minorToInput(job.payMaxMinor),
            payUnit: job.payUnit ?? "",
            description: job.description,
            skills: job.skills.join(", "),
            closesOn: job.closesOn < today ? today : job.closesOn,
          }}
        />
      </Card>
    </div>
  );
}
