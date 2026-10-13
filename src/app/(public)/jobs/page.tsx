import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Plus, ShieldAlert } from "lucide-react";
import { inputClass } from "@/components/input-class";
import { Callout, EmptyState, buttonClass, cx } from "@/components/ui";
import { formatCalendarDate } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { JOB_KINDS, WORK_MODES, listJobs } from "@/modules/community/jobs";
import { JobBadges, payLabel } from "./job-ui";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata("Jobs & gigs", "Paid jobs, gigs and internships for developers and builders in Ghana, always with the pay shown and never a fee to apply.");

// Phase 33: the jobs & gigs board. Open jobs, newest first.

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ kind?: string; mode?: string; skill?: string; q?: string }> }) {
  const viewer = await getSignedIn();
  const params = await searchParams;
  const jobs = await listJobs(params);
  const qs = (patch: Record<string, string | undefined>) => {
    const merged = { ...params, ...patch };
    const s = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]).toString();
    return s ? `/jobs?${s}` : "/jobs";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Jobs &amp; gigs</h1>
          <p className="max-w-2xl text-sm text-muted">Paid work from members and the companies they work with: jobs, gigs and internships. Every job and gig shows what it pays.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {viewer && (
            <Link href="/community/jobs" className={buttonClass("secondary")}>
              My jobs &amp; applications
            </Link>
          )}
          {viewer ? (
            <Link href="/community/jobs/new" className={buttonClass("primary")}>
              <Plus className="size-4" aria-hidden /> Post a job
            </Link>
          ) : signupOpen() ? (
            <Link href="/sign-up" className={buttonClass("primary")}>
              Join to apply
            </Link>
          ) : null}
        </div>
      </div>

      <Callout tone="warn" icon={ShieldAlert}>
        Never pay to get a job. Nobody here may ask you for a registration, training or application fee. Report any post or message that does.
      </Callout>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Type" className="flex gap-1 rounded-lg bg-surface-muted p-1 text-sm">
          {[{ key: undefined, label: "All" }, ...Object.entries(JOB_KINDS).map(([key, label]) => ({ key, label: `${label}s` }))].map((k) => (
            <Link
              key={k.label}
              href={qs({ kind: k.key })}
              className={cx("rounded-md px-3 py-1.5", (params.kind ?? undefined) === k.key ? "bg-surface font-medium text-fg shadow-xs" : "text-muted hover:text-fg")}
            >
              {k.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(WORK_MODES).map(([key, label]) => (
            <Link
              key={key}
              href={qs({ mode: params.mode === key ? undefined : key })}
              className={cx("rounded-full border px-3 py-1 text-sm", params.mode === key ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "border-line text-muted")}
            >
              {label}
            </Link>
          ))}
        </div>
        <form className="flex min-w-60 flex-1 gap-2" role="search">
          {params.kind && <input type="hidden" name="kind" value={params.kind} />}
          {params.mode && <input type="hidden" name="mode" value={params.mode} />}
          <input name="q" defaultValue={params.q} placeholder="Search: skill, city, company" aria-label="Search jobs" className={inputClass} />
          <button type="submit" className={buttonClass("secondary")}>
            Search
          </button>
        </form>
      </div>
      {params.skill && (
        <p className="text-sm text-muted">
          Skill: <strong>{params.skill}</strong>{" "}
          <Link href={qs({ skill: undefined })} className="text-brand-600 hover:underline dark:text-brand-400">
            Clear
          </Link>
        </p>
      )}

      {jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title="No open jobs match">
          {viewer ? "Hiring? Post a job or a gig." : "New jobs and gigs are posted every week."}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={`/jobs/${j.id}`} className="flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-5 shadow-xs hover:border-brand-500">
                <JobBadges job={j} />
                <p className="font-medium">{j.title}</p>
                <p className="text-sm text-muted">{j.hirer}</p>
                <p className="text-sm font-medium tabular-nums">{payLabel(j)}</p>
                {j.skills.length > 0 && <p className="text-xs text-muted">{j.skills.join(" · ")}</p>}
                <p className="mt-auto text-xs text-muted">Apply by {formatCalendarDate(j.closesOn)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
