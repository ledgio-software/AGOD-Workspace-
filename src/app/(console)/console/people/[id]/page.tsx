import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Callout, Card, PageHeader, StatCard } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { roleLabel } from "@/lib/labels";
import { getSignedIn } from "@/lib/session";
import { getPerson } from "@/modules/platform";
import { blockLoginAction, resetLinkAction } from "../../actions";
import { AuditList } from "../../audit-list";
import { ConfirmButton, ReasonForm } from "../../forms";

export const metadata = { title: "Person" };

// Phase 40: one login: their companies and community profile, and what staff can do about them.

export default async function ConsolePerson({ params }: { params: Promise<{ id: string }> }) {
  const me = (await getSignedIn())!;
  const p = await getPerson(me, (await params).id);
  if (!p) notFound();
  const self = p.id === me.id;

  return (
    <>
      <Link href="/console/people" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> People
      </Link>
      <PageHeader eyebrow={p.staff ? "Back-office staff" : undefined} title={p.name} description={`${p.email} · joined ${formatDate(p.createdAt)}${p.verified ? "" : " · email not confirmed"}`} />
      {!p.active && <Callout tone="bad">This login is blocked: they can&apos;t sign in. Their companies and posts are unchanged.</Callout>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Companies" value={p.companies} />
        <StatCard label="Signed in on" value={p.openSessions} hint="devices right now" />
        <StatCard label="Last seen" value={p.lastSeen ? formatDate(p.lastSeen) : "Never"} />
        <StatCard label="Community" value={p.profile ? (p.profile.communityRole === "ORGANIZER" ? "Organizer" : "Builder") : "No profile"} hint={p.profile ? `${p.profile.visibility === "PUBLIC" ? "Public" : "Members only"}${p.profile.hidden ? " · hidden" : ""}` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card title="Companies">
            {p.companyList.length === 0 ? (
              <p className="text-sm text-muted">Not in any company: community only.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {p.companyList.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <Link href={`/console/companies/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-muted">
                      {roleLabel[c.role as keyof typeof roleLabel] ?? c.role}
                      {!c.active && " · removed"}
                      {c.suspended && " · company suspended"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {p.profile && (
            <Card title="Community profile">
              <Link href={`/members/${p.profile.handle}`} className="text-sm font-medium hover:underline">
                /members/{p.profile.handle}
              </Link>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {self ? (
            <Card title="Your own login">
              <p className="text-sm text-muted">You can&apos;t block yourself here.</p>
            </Card>
          ) : p.staff && p.active ? (
            <Card title="Back-office staff">
              <p className="text-sm text-muted">Staff can&apos;t be blocked from the console. Remove them from PLATFORM_ADMIN_EMAILS first.</p>
            </Card>
          ) : (
            <Card title={p.active ? "Block this login" : "Restore this login"} description={p.active ? "Signs them out everywhere and stops them signing in. Their companies, posts and data stay as they are." : "They can sign in again."}>
              <ReasonForm
                action={blockLoginAction.bind(null, p.id, p.active)}
                label={p.active ? "Block login" : "Restore login"}
                danger={p.active}
                confirmMessage={p.active ? `Block ${p.name}? They'll be signed out right away.` : `Restore ${p.name}'s login?`}
                placeholder={p.active ? "e.g. Spam account, or they asked" : "e.g. Blocked by mistake"}
              />
            </Card>
          )}
          {p.active && (
            <Card title="Password link" description="Emails them a link to choose a new password, valid for one day.">
              <ConfirmButton action={resetLinkAction.bind(null, p.id)} label="Email a password link" confirmMessage={`Email a password link to ${p.email}?`} />
            </Card>
          )}
          <Card title="Back-office log">
            <AuditList rows={p.log} empty="No back-office actions on this person yet." />
          </Card>
        </div>
      </div>
    </>
  );
}
