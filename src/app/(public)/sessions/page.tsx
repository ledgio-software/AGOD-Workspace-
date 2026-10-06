import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonClass, cx } from "@/components/ui";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { listSessions } from "@/modules/community/sessions";
import { SessionList } from "./session-list";

export const metadata: Metadata = { title: "Teaching sessions" };

export default async function SessionsPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  const viewer = await getSignedIn();
  const params = await searchParams;
  const past = params.show === "recordings";
  const page = Number(params.page) || 1;
  const { sessions, more } = await listSessions(past ? "past" : "upcoming", { page });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Teaching sessions</h1>
          <p className="text-sm text-muted">Live group calls where experienced builders teach how to code and how to use AI tools. Join one, or host your own.</p>
        </div>
        {viewer ? (
          <Link href="/community/sessions/new" className={buttonClass("primary")}>
            <Plus className="size-4" aria-hidden /> Host a session
          </Link>
        ) : signupOpen() ? (
          <Link href="/sign-up" className={buttonClass("primary")}>
            Join to take part
          </Link>
        ) : null}
      </div>
      <nav aria-label="Sessions" className="flex w-fit gap-1 rounded-lg bg-surface-muted p-1 text-sm">
        {[
          { href: "/sessions", label: "Upcoming", active: !past },
          { href: "/sessions?show=recordings", label: "Past sessions & recordings", active: past },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            className={cx("rounded-md px-3 py-1.5", t.active ? "bg-surface font-medium text-fg shadow-xs" : "text-muted hover:text-fg")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <SessionList sessions={sessions} past={past} empty={past ? "No past sessions yet." : "No sessions scheduled yet. Reviewers can host one!"} />
      {more && (
        <Link href={`/sessions?${new URLSearchParams({ ...(past ? { show: "recordings" } : {}), page: String(page + 1) })}`} className={buttonClass("secondary", "sm")}>
          More sessions
        </Link>
      )}
    </div>
  );
}
