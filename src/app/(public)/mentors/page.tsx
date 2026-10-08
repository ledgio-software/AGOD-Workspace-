import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap, MapPin } from "lucide-react";
import { Badge } from "@/components/badges";
import { inputClass } from "@/components/input-class";
import { Avatar, EmptyState, buttonClass } from "@/components/ui";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { MAX_OPEN_AS_MENTEE, listMentors } from "@/modules/community/mentorship";
import { requestMentorAction } from "../../(community)/community/growth-actions";
import { AskMentorForm } from "../../(community)/community/growth-forms";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata("Mentors", "Find a mentor in Ghana's builder community: experienced developers and Reviewers who help you learn, review your work and grow.");

// Phase 31: Reviewers who are open to mentoring, best match first for the signed-in member.

export default async function MentorsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const viewer = await getSignedIn();
  const { q } = await searchParams;
  const mentors = await listMentors(viewer, { q });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Mentors</h1>
          <p className="max-w-2xl text-sm text-muted">
            Experienced builders who help others one to one. {viewer ? "Best matches for you come first: the same tools as you, then the same city." : "Join the community to ask one."} You can ask up to{" "}
            {MAX_OPEN_AS_MENTEE} mentors at a time.
          </p>
        </div>
        {viewer ? (
          <Link href="/community/mentoring" className={buttonClass("secondary")}>
            My mentoring
          </Link>
        ) : signupOpen() ? (
          <Link href="/sign-up" className={buttonClass("primary")}>
            Join to ask a mentor
          </Link>
        ) : null}
      </div>
      <form className="flex max-w-md gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search by name, tool or topic" aria-label="Search mentors" className={inputClass} />
        <button type="submit" className={buttonClass("secondary")}>
          Search
        </button>
      </form>
      {mentors.length === 0 ? (
        <EmptyState icon={GraduationCap} title={q ? "No mentors match" : "No mentors yet"}>
          Reviewers can offer to mentor on their My mentoring page.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {mentors.map((m) => (
            <li key={m.userId} className="space-y-3 rounded-xl border border-line bg-surface p-5 shadow-xs">
              <div className="flex items-start gap-3">
                <Avatar name={m.name} />
                <div className="min-w-0 flex-1">
                  <Link href={`/members/${m.handle}`} className="font-medium hover:underline">
                    {m.name}
                  </Link>
                  {m.headline && <p className="text-sm text-muted">{m.headline}</p>}
                  {m.city && (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted">
                      <MapPin className="size-3" aria-hidden /> {m.city}
                    </p>
                  )}
                </div>
                {m.hasSpace ? <Badge tone="green">Has space</Badge> : <Badge>Full</Badge>}
              </div>
              {m.note && <p className="text-sm">{m.note}</p>}
              {m.tools.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.tools.map((t) => (
                    <span key={t} className={m.sharedTools.includes(t) ? "rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted"}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {(m.sharedTools.length > 0 || m.sameCity) && (
                <p className="text-xs text-brand-700 dark:text-brand-300">
                  Good match: {[m.sharedTools.length > 0 && `you both use ${m.sharedTools.join(", ")}`, m.sameCity && "same city"].filter(Boolean).join(" · ")}
                </p>
              )}
              {viewer && m.hasSpace && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-brand-600 dark:text-brand-400">Ask {m.name.split(/\s+/)[0]} to mentor you</summary>
                  <div className="mt-2">
                    <AskMentorForm action={requestMentorAction.bind(null, m.handle)} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
