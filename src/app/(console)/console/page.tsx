import { AlertTriangle, Building2, CheckCircle2, CircleSlash, Flag, Newspaper, ShieldAlert, UserRoundX, Users } from "lucide-react";
import { Card, PageHeader, StatCard, cx } from "@/components/ui";
import { getSignedIn } from "@/lib/session";
import { health, overview } from "@/modules/platform";
import { safetyCounts } from "@/modules/safety";

// Phase 40: the platform at a glance, and whether the parts that run on their own are working.

const STATE = {
  ok: { icon: CheckCircle2, cls: "text-emerald-600 dark:text-emerald-400", label: "Working" },
  warn: { icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400", label: "Needs a look" },
  off: { icon: CircleSlash, cls: "text-muted", label: "Off" },
} as const;

export default async function ConsoleOverview() {
  const me = (await getSignedIn())!;
  const [o, checks, safety] = await Promise.all([overview(me), health(me), safetyCounts(me)]);
  const most = Math.max(1, ...o.signupsByWeek.map((w) => w.people));

  return (
    <>
      <PageHeader title="Overview" description="The whole platform: every company and the community. Company details stay summaries; nothing here opens a company's projects or money." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="People" value={o.people} hint={`${o.newPeople7d} new this week · ${o.activeLogins7d} signed in`} icon={Users} href="/console/people" />
        <StatCard label="Companies" value={o.companies} hint={o.suspendedCompanies ? `${o.suspendedCompanies} suspended` : "None suspended"} icon={Building2} href="/console/companies" />
        <StatCard label="Open reports" value={o.openReports} hint="Waiting for an organizer" icon={Flag} tone={o.openReports ? "warn" : "default"} href="/console/moderation" />
        <StatCard label="Blocked logins" value={o.blockedLogins} hint="Can't sign in" icon={UserRoundX} href="/console/people?status=blocked" />
        <StatCard label="Community members" value={o.communityMembers} />
        <StatCard label="Projects shared" value={o.projects} />
        <StatCard label="Published articles" value={o.articles} icon={Newspaper} />
        <StatCard label="Open jobs & gigs" value={o.openJobs} />
        <StatCard label="Jobs waiting for a check" value={safety.heldJobs} tone={safety.heldJobs ? "warn" : "default"} icon={ShieldAlert} href="/console/safety" />
        <StatCard label="Risk flags" value={safety.openFlags} hint="Found by the scam check" tone={safety.openFlags ? "warn" : "default"} href="/console/safety" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="System health" description="Checked now.">
          <ul className="divide-y divide-line">
            {checks.map((c) => {
              const s = STATE[c.state];
              return (
                <li key={c.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <s.icon className={cx("mt-0.5 size-4 shrink-0", s.cls)} aria-label={s.label} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-sm text-muted">{c.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="New people per week" description="Last 8 weeks.">
          <table className="w-full text-sm">
            <tbody>
              {o.signupsByWeek.map((w) => (
                <tr key={w.week}>
                  <td className="w-16 py-1 pr-2 text-muted">{w.week}</td>
                  <td className="py-1">
                    <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(2, (w.people / most) * 100)}%` }} aria-hidden />
                  </td>
                  <td className="w-10 py-1 pl-2 text-right tabular-nums">{w.people}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
