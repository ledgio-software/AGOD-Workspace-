import { Badge } from "@/components/badges";
import { formatMoney } from "@/lib/money";
import { JOB_KINDS, type JobCard, PAY_UNITS, WORK_MODES } from "@/modules/community/jobs";

// Phase 33: shared bits of the job pages.

/** "GHS 2,500.00 to GHS 4,000.00 for the work", or "Pay not stated" (internships only). */
export function payLabel(j: Pick<JobCard, "payMinMinor" | "payMaxMinor" | "payUnit" | "currency">): string {
  if (j.payMinMinor === null || !j.payUnit) return "Pay not stated";
  const range = j.payMaxMinor && j.payMaxMinor > j.payMinMinor ? `${formatMoney(j.payMinMinor, j.currency)} to ${formatMoney(j.payMaxMinor, j.currency)}` : formatMoney(j.payMinMinor, j.currency);
  return `${range} ${PAY_UNITS[j.payUnit]}`;
}

export function JobBadges({ job }: { job: Pick<JobCard, "kind" | "workMode" | "location"> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={job.kind === "JOB" ? "blue" : job.kind === "GIG" ? "violet" : "green"}>{JOB_KINDS[job.kind]}</Badge>
      <Badge>{WORK_MODES[job.workMode]}</Badge>
      {job.location && <Badge>{job.location}</Badge>}
    </div>
  );
}
