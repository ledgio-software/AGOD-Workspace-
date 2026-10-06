import Link from "next/link";
import { Plug, ShieldCheck, UserCheck, UserPlus, Users } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/badges";
import { Avatar, ButtonLink, Card, Disclosure, PageHeader, StatCard, cx, table } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { roleLabel } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { emailConfig } from "@/lib/email";
import { requireUser } from "@/lib/session";
import { listTeam } from "@/modules/team";
import { CreateMemberForm, MemberActions } from "./team-forms";

const roleTone = { ADMIN: "violet", PROJECT_MANAGER: "blue", TEAM_MEMBER: "gray" } as const;

export default async function TeamPage() {
  const actor = await requireUser();
  const viaEmail = emailConfig() !== null;
  if (!can(actor, "team.view")) return <AccessDenied what="the team list" />;

  const members = await listTeam(actor);
  const canManage = can(actor, "team.manage");
  const active = members.filter((m) => m.active);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Team & admin"
        title="Team"
        description={
          canManage
            ? "Add members, change roles and deactivate accounts. Every change is recorded in the audit log."
            : "Team members and their roles. Only Admins can make changes."
        }
        actions={
          canManage && (
            <ButtonLink href="/integrations">
              <Plug className="size-4" aria-hidden /> GitHub integration
            </ButtonLink>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active members" value={active.length} icon={UserCheck} tone="good" />
        <StatCard label="Admins" value={active.filter((m) => m.role === "ADMIN").length} icon={ShieldCheck} />
        <StatCard label="Project managers" value={active.filter((m) => m.role === "PROJECT_MANAGER").length} icon={Users} />
        <StatCard label="Inactive" value={members.length - active.length} icon={Users} />
      </div>

      {canManage && (
        <Disclosure
          className="bg-surface shadow-xs"
          summary={
            <span className="inline-flex items-center gap-2">
              <UserPlus className="size-4 text-brand-600" aria-hidden /> Add a member
            </span>
          }
        >
          <CreateMemberForm />
        </Disclosure>
      )}

      <Card bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Member</th>
                <th className={table.th}>Role</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Capacity</th>
                <th className={table.th}>Added</th>
                {canManage && <th className={`${table.th} text-right`}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className={cx(table.row, "align-top", !member.active && "text-muted")}>
                  <td className={table.td}>
                    <Link href={`/team/${member.id}`} className="flex items-center gap-3 hover:text-brand-600">
                      <Avatar name={member.name} />
                      <span className="min-w-0">
                        <span className="block font-medium">{member.name}</span>
                        <span className="block text-xs text-muted">{member.email}</span>
                      </span>
                    </Link>
                  </td>
                  <td className={table.td}>
                    <Badge tone={roleTone[member.role]}>{roleLabel[member.role]}</Badge>
                  </td>
                  <td className={table.td}>
                    <Badge tone={member.active ? "green" : "gray"}>{member.active ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className={`${table.td} tabular-nums`}>{member.weeklyCapacityHours}h / week</td>
                  <td className={`${table.td} whitespace-nowrap text-muted`}>{formatDate(member.createdAt)}</td>
                  {canManage && (
                    <td className={`${table.td} text-right`}>
                      {member.id === actor.id ? <span className="text-xs text-muted">You</span> : <MemberActions member={member} viaEmail={viaEmail} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
