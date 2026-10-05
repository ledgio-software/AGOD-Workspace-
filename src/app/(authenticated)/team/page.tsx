import { AccessDenied } from "@/components/access-denied";
import { formatDate } from "@/lib/dates";
import { roleLabel } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listTeam } from "@/modules/team";
import { CreateMemberForm, MemberActions } from "./team-forms";

export default async function TeamPage() {
  const actor = await requireUser();
  if (!can(actor, "team.view")) return <AccessDenied what="the team list" />;

  const members = await listTeam(actor);
  const canManage = can(actor, "team.manage");

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Team</h1>
        <p className="text-sm text-zinc-500">
          {canManage
            ? "Add members, change roles and deactivate accounts. Every change is recorded in the audit log."
            : "Team members and their roles. Only Admins can make changes."}
        </p>
      </div>

      {canManage && <CreateMemberForm />}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Added</th>
              {canManage && <th className="py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                <td className="py-3 pr-4">{member.name}</td>
                <td className="py-3 pr-4">{member.email}</td>
                <td className="py-3 pr-4">{roleLabel[member.role]}</td>
                <td className="py-3 pr-4">
                  {member.active ? "Active" : <span className="text-zinc-500">Inactive</span>}
                </td>
                <td className="py-3 pr-4">{formatDate(member.createdAt)}</td>
                {canManage && (
                  <td className="py-3">
                    {member.id === actor.id ? (
                      <span className="text-zinc-500">You</span>
                    ) : (
                      <MemberActions member={member} />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
