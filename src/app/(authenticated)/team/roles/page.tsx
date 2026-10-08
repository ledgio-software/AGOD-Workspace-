import Link from "next/link";
import { ArrowLeft, Check, KeyRound, Sparkles, Tags } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/badges";
import { Callout, Card, PageHeader, cx, table } from "@/components/ui";
import { roleLabel } from "@/lib/labels";
import { PERMISSION_GROUPS, can, groupsOf } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listJobTitles, listRoles, needsTeamSetup } from "@/modules/roles";
import { TEAM_TYPES, teamTypeLabel } from "@/modules/roles/presets";
import { listTeam } from "@/modules/team";
import {
  addJobTitleAction,
  archiveJobTitleAction,
  archiveRoleAction,
  createRoleAction,
  renameJobTitleAction,
  teamTypeAction,
  updateRoleAction,
} from "./actions";
import { AddTitleForm, CreateRoleForm, EditRoleForm, RenameTitleForm, SmallButtonForm, TeamTypeForm } from "./forms";

// Phase 28: each company sets up its own roles (what people may do) and job titles (what they do).

const teamTypeHint = {
  SOFTWARE: "Developers, designers, QA and DevOps; a Team Lead role and a Finance role.",
  FINTECH: "The same, plus security, compliance and payments people, and a read-only Compliance role.",
  OTHER: "A short general list to start from.",
} as const;

export default async function RolesPage() {
  const actor = await requireUser();
  if (!can(actor, "team.view")) return <AccessDenied what="roles and job titles" />;
  const [roles, titles, members, setup] = await Promise.all([listRoles(actor), listJobTitles(actor), listTeam(actor), needsTeamSetup(actor)]);
  const canManage = can(actor, "team.manage");
  const canSetUp = canManage && can(actor, "company.manage");
  const holders = (ref: string) => members.filter((m) => m.active && (m.companyRoleId ?? m.role) === ref).length;
  const visibleRoles = roles.filter((r) => !r.archived);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/team" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3" aria-hidden /> Team
          </Link>
        }
        title="Roles & job titles"
        description="A role decides what someone can do in this workspace. A job title says what they do (Backend developer, QA). Job titles never give access to anything."
      />

      {canSetUp && (
        <Card
          title={setup ? "What kind of team are you?" : "Add suggestions for your kind of team"}
          description={
            setup
              ? "Pick one and we add the usual job titles and a few ready-made roles. You can change, add or archive any of them afterwards."
              : "Adds only what you don't have yet. Nothing is changed or removed."
          }
          aside={<Sparkles className="size-4 text-muted" aria-hidden />}
        >
          <TeamTypeForm action={teamTypeAction} options={TEAM_TYPES.map((t) => ({ value: t, label: teamTypeLabel[t], hint: teamTypeHint[t] }))} />
        </Card>
      )}

      <Card title="Who can do what" description="Built-in roles can't be changed. Your own roles start from one of them and switch things off." aside={<KeyRound className="size-4 text-muted" aria-hidden />} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Permission</th>
                {visibleRoles.map((r) => (
                  <th key={r.ref} className={cx(table.th, "text-center")}>
                    <span className="block">{r.name}</span>
                    <span className="block text-[10px] font-normal normal-case text-muted">
                      {r.builtIn ? "built in" : `from ${roleLabel[r.baseRole]}`} · {holders(r.ref)} {holders(r.ref) === 1 ? "person" : "people"}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className={table.row}>
                <td className={table.td}>
                  <span className="font-medium">Their own work</span>
                  <span className="block text-xs text-muted">Projects they&apos;re on, their tasks, the discussion, their own payouts and questions.</span>
                </td>
                {visibleRoles.map((r) => (
                  <td key={r.ref} className={cx(table.td, "text-center")}>
                    <Check className="mx-auto size-4 text-emerald-600" aria-label="Yes" />
                  </td>
                ))}
              </tr>
              {PERMISSION_GROUPS.map((g) => (
                <tr key={g.key} className={table.row}>
                  <td className={table.td}>
                    <span className="font-medium">{g.label}</span> {g.money && <Badge tone="amber">money</Badge>}
                    <span className="block text-xs text-muted">{g.description}</span>
                  </td>
                  {visibleRoles.map((r) => (
                    <td key={r.ref} className={cx(table.td, "text-center")}>
                      {r.permissions.includes(g.key) ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Yes" /> : <span className="text-muted" aria-label="No">–</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Your roles" description={canManage ? "Make a role by copying one, then switch permissions on or off." : "Only people who manage the team can change roles."}>
        <div className="space-y-5">
          {canManage && <CreateRoleForm action={createRoleAction} sources={visibleRoles.map((r) => ({ ref: r.ref, name: r.name }))} />}
          {roles.filter((r) => !r.builtIn).length === 0 ? (
            <p className="text-sm text-muted">No roles of your own yet. Everyone uses the built-in Team Member, Project Manager and Admin roles.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {roles
                .filter((r) => !r.builtIn)
                .map((r) => (
                  <li key={r.ref} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {r.name} {r.archived && <Badge>Archived</Badge>}
                        </p>
                        <p className="text-xs text-muted">
                          Starts from {roleLabel[r.baseRole]} · {holders(r.ref)} {holders(r.ref) === 1 ? "person" : "people"}
                          {r.description ? ` · ${r.description}` : ""}
                        </p>
                      </div>
                      {canManage && (
                        <SmallButtonForm
                          action={archiveRoleAction.bind(null, r.ref, !r.archived)}
                          label={r.archived ? "Restore" : "Archive"}
                          confirmMessage={r.archived ? undefined : `Archive "${r.name}"? Nobody can be given it until it's restored.`}
                        />
                      )}
                    </div>
                    {canManage && !r.archived && (
                      <details>
                        <summary className="cursor-pointer text-sm font-medium text-brand-600 dark:text-brand-400">Edit name and permissions</summary>
                        <div className="mt-3">
                          <EditRoleForm
                            action={updateRoleAction.bind(null, r.ref)}
                            role={r}
                            groups={PERMISSION_GROUPS.filter((g) => groupsOf(r.baseRole).includes(g.key))}
                          />
                        </div>
                      </details>
                    )}
                  </li>
                ))}
            </ul>
          )}
          <Callout tone="info">
            Safety rules: there is always at least one Admin with full access; nobody can change their own role or give access they don&apos;t have; and
            every change is in the audit log.
          </Callout>
        </div>
      </Card>

      <Card title="Job titles" description="Used on the Team page and when you add someone to a project." aside={<Tags className="size-4 text-muted" aria-hidden />}>
        <div className="space-y-4">
          {canManage && <AddTitleForm action={addJobTitleAction} />}
          {titles.length === 0 ? (
            <p className="text-sm text-muted">No job titles yet.{canSetUp ? " Pick your kind of team above to start with the usual ones." : ""}</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {titles.map((t) => (
                <li key={t.id} className={cx("flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm", t.archived && "text-muted")}>
                  {canManage && !t.archived ? (
                    <RenameTitleForm action={renameJobTitleAction.bind(null, t.id)} name={t.name} />
                  ) : (
                    <span>
                      {t.name} {t.archived && <Badge>Archived</Badge>}
                    </span>
                  )}
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-muted">
                      {t.people} {t.people === 1 ? "person" : "people"}
                    </span>
                    {canManage && <SmallButtonForm action={archiveJobTitleAction.bind(null, t.id, !t.archived)} label={t.archived ? "Restore" : "Archive"} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
