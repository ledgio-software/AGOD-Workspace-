import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { companyRoles, jobTitles, memberships, organizations } from "@/lib/db/schema";
import { roleLabel } from "@/lib/labels";
import { type Actor, type PermissionKey, PERMISSION_GROUPS, type Role, assertCan, effectiveGroups, groupsOf } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { isUniqueViolation } from "@/modules/db-errors";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { JOB_TITLE_PRESETS, ROLE_PRESETS, TEAM_TYPES, type TeamType } from "./presets";

// Phase 28: each company's own roles and job titles. A role is either built in (Team Member,
// Project Manager, Admin: always there, full access for their level) or made by the company
// from one of them with some permission groups switched off. Job titles describe the work
// (Backend developer, QA) and grant nothing.

export const BUILT_IN_ROLES = ["TEAM_MEMBER", "PROJECT_MANAGER", "ADMIN"] as const satisfies readonly Role[];

export type RoleOption = {
  /** The built-in role, or the company role's id. */
  ref: string;
  name: string;
  description: string | null;
  baseRole: Role;
  permissions: PermissionKey[];
  builtIn: boolean;
  archived: boolean;
};

const builtInDescription: Record<Role, string> = {
  TEAM_MEMBER: "Works on the projects they're added to: their tasks, the discussion, their own payouts.",
  PROJECT_MANAGER: "Runs every project, approves finished work, sees the team and the money reports.",
  ADMIN: "Everything, including paying the team, people and roles, and company settings.",
};

function builtIn(role: Role): RoleOption {
  return { ref: role, name: roleLabel[role], description: builtInDescription[role], baseRole: role, permissions: groupsOf(role), builtIn: true, archived: false };
}

const fromRow = (r: typeof companyRoles.$inferSelect): RoleOption => ({
  ref: r.id,
  name: r.name,
  description: r.description,
  baseRole: r.baseRole,
  permissions: groupsOf(r.baseRole).filter((k) => r.permissions.includes(k)),
  builtIn: false,
  archived: r.archivedAt !== null,
});

/** The built-in roles first, then the company's own (archived ones last). Everyone in the company may read them. */
export async function listRoles(actor: Actor): Promise<RoleOption[]> {
  const rows = await withActor(actor, (tx) => tx.select().from(companyRoles).orderBy(asc(companyRoles.archivedAt), asc(companyRoles.name)));
  return [...BUILT_IN_ROLES.map(builtIn), ...rows.map(fromRow)];
}

/** Resolves a role picked in a form ("ADMIN", or a company role's id) inside the company. */
export async function resolveRole(tx: Tx, ref: string): Promise<RoleOption & { companyRoleId: string | null }> {
  if ((BUILT_IN_ROLES as readonly string[]).includes(ref)) return { ...builtIn(ref as Role), companyRoleId: null };
  if (!z.uuid().safeParse(ref).success) throw new ServiceError("Choose a role.");
  const [row] = await tx.select().from(companyRoles).where(eq(companyRoles.id, ref));
  if (!row) throw new ServiceError("That role doesn't exist in this company.");
  if (row.archivedAt) throw new ServiceError(`The role "${row.name}" is archived.`);
  return { ...fromRow(row), companyRoleId: row.id };
}

/** Nobody hands out access they don't have themselves. */
export function assertCanGrant(actor: Actor, role: Pick<RoleOption, "baseRole" | "permissions" | "name">) {
  const rank: Record<Role, number> = { TEAM_MEMBER: 0, PROJECT_MANAGER: 1, ADMIN: 2 };
  const mine = effectiveGroups(actor);
  const missing = role.permissions.filter((k) => !mine.includes(k));
  if (rank[role.baseRole] > rank[actor.role] || missing.length > 0) {
    const labels = missing.map((k) => PERMISSION_GROUPS.find((g) => g.key === k)?.label ?? k);
    throw new ServiceError(
      `You can't give the "${role.name}" role: it includes access you don't have yourself${labels.length ? ` (${labels.join(", ")})` : ""}. Ask an Admin with full access.`,
    );
  }
}

const roleName = z.string().trim().min(2, "Give the role a name (at least 2 characters)").max(60);
const description = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v === "" ? null : v))
  .nullish();
const permissionList = z.array(z.enum(PERMISSION_GROUPS.map((g) => g.key) as [PermissionKey, ...PermissionKey[]]));

export const createRoleInput = z.object({
  name: roleName,
  description,
  /** The role to start from: a built-in role or one of the company's roles. */
  copyFrom: z.string().min(1, "Choose a role to start from"),
  permissions: permissionList.optional(),
});

export const updateRoleInput = z.object({ name: roleName, description, permissions: permissionList });

function cleanPermissions(baseRole: Role, permissions: PermissionKey[]): PermissionKey[] {
  const allowed = groupsOf(baseRole);
  return PERMISSION_GROUPS.map((g) => g.key).filter((k) => allowed.includes(k) && permissions.includes(k));
}

function rethrowName(error: unknown, name: string): never {
  if (isUniqueViolation(error)) throw new ServiceError(`There is already a role or title called "${name}".`);
  rethrowDbGuard(error);
}

/** Admins (with "Manage people and roles"): a new role, copied from an existing one. */
export async function createRole(actor: Actor, raw: z.input<typeof createRoleInput>, request?: RequestMeta): Promise<string> {
  assertCan(actor, "team.manage");
  const input = createRoleInput.parse(raw);
  if ((BUILT_IN_ROLES as readonly string[]).some((r) => roleLabel[r as Role].toLowerCase() === input.name.toLowerCase())) {
    throw new ServiceError(`"${input.name}" is a built-in role. Pick another name.`);
  }
  return withActor(actor, async (tx) => {
    const source = await resolveRole(tx, input.copyFrom);
    const permissions = cleanPermissions(source.baseRole, input.permissions ?? source.permissions);
    assertCanGrant(actor, { baseRole: source.baseRole, permissions, name: input.name });
    const [row] = await tx
      .insert(companyRoles)
      .values({ name: input.name, description: input.description ?? null, baseRole: source.baseRole, permissions, createdBy: actor.id })
      .returning()
      .catch((error) => rethrowName(error, input.name));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "role",
      entityId: row.id,
      action: "role.created",
      after: { name: row.name, baseRole: row.baseRole, permissions, copiedFrom: source.name },
      request,
    });
    return row.id;
  });
}

/** Rename a company role or switch its permission groups on or off (within its starting role). */
export async function updateRole(actor: Actor, roleId: string, raw: z.input<typeof updateRoleInput>, request?: RequestMeta) {
  assertCan(actor, "team.manage");
  const input = updateRoleInput.parse(raw);
  await withActor(actor, async (tx) => {
    const [before] = await tx.select().from(companyRoles).where(eq(companyRoles.id, roleId));
    if (!before) throw new ServiceError("Role not found.");
    const permissions = cleanPermissions(before.baseRole, input.permissions);
    // Both what it gave before and what it gives now must be within the editor's own access.
    assertCanGrant(actor, { baseRole: before.baseRole, permissions: [...new Set([...permissions, ...fromRow(before).permissions])], name: before.name });
    const same = before.name === input.name && (before.description ?? null) === (input.description ?? null) && before.permissions.join() === permissions.join();
    if (same) return;
    await tx
      .update(companyRoles)
      .set({ name: input.name, description: input.description ?? null, permissions })
      .where(eq(companyRoles.id, roleId))
      .catch((error) => rethrowName(error, input.name));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "role",
      entityId: roleId,
      action: "role.updated",
      before: { name: before.name, description: before.description, permissions: fromRow(before).permissions },
      after: { name: input.name, description: input.description ?? null, permissions },
      request,
    });
  });
}

/** Archive (nobody may hold it) or bring back a company role. */
export async function setRoleArchived(actor: Actor, roleId: string, archived: boolean, request?: RequestMeta) {
  assertCan(actor, "team.manage");
  await withActor(actor, async (tx) => {
    const [before] = await tx.select().from(companyRoles).where(eq(companyRoles.id, roleId));
    if (!before) throw new ServiceError("Role not found.");
    if ((before.archivedAt !== null) === archived) return;
    assertCanGrant(actor, fromRow(before));
    await tx
      .update(companyRoles)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(companyRoles.id, roleId))
      .catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "role", entityId: roleId, action: archived ? "role.archived" : "role.restored", after: { name: before.name }, request });
  });
}

// --- Job titles -----------------------------------------------------------------------------

export type JobTitle = { id: string; name: string; archived: boolean; people: number };

const titleName = z.string().trim().min(2, "Give the job title a name (at least 2 characters)").max(60);

/** The company's job titles with how many active people hold each (active titles first). */
export async function listJobTitles(actor: Actor): Promise<JobTitle[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: jobTitles.id,
        name: jobTitles.name,
        archivedAt: jobTitles.archivedAt,
        people: sql<number>`(select count(*)::int from memberships m where m.job_title_id = "job_titles"."id" and m.active)`,
      })
      .from(jobTitles)
      .orderBy(asc(jobTitles.archivedAt), asc(sql`lower(${jobTitles.name})`));
    return rows.map((r) => ({ id: r.id, name: r.name, archived: r.archivedAt !== null, people: r.people }));
  });
}

/** Active job title names, for picking someone's role on a project. */
export async function activeJobTitleNames(actor: Actor): Promise<string[]> {
  return withActor(actor, async (tx) =>
    (await tx.select({ name: jobTitles.name }).from(jobTitles).where(isNull(jobTitles.archivedAt)).orderBy(asc(sql`lower(${jobTitles.name})`))).map((r) => r.name),
  );
}

export async function addJobTitle(actor: Actor, rawName: string, request?: RequestMeta): Promise<void> {
  assertCan(actor, "team.manage");
  const name = titleName.parse(rawName);
  await withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(jobTitles)
      .values({ name })
      .returning()
      .catch((error) => rethrowName(error, name));
    await recordAudit(tx, { actorId: actor.id, entityType: "job_title", entityId: row.id, action: "job_title.created", after: { name }, request });
  });
}

export async function renameJobTitle(actor: Actor, titleId: string, rawName: string, request?: RequestMeta): Promise<void> {
  assertCan(actor, "team.manage");
  const name = titleName.parse(rawName);
  await withActor(actor, async (tx) => {
    const [before] = await tx.select().from(jobTitles).where(eq(jobTitles.id, titleId));
    if (!before) throw new ServiceError("Job title not found.");
    if (before.name === name) return;
    await tx
      .update(jobTitles)
      .set({ name })
      .where(eq(jobTitles.id, titleId))
      .catch((error) => rethrowName(error, name));
    await recordAudit(tx, { actorId: actor.id, entityType: "job_title", entityId: titleId, action: "job_title.renamed", before: { name: before.name }, after: { name }, request });
  });
}

/** Archived titles stay on the people who have them but can't be picked any more. */
export async function setJobTitleArchived(actor: Actor, titleId: string, archived: boolean, request?: RequestMeta): Promise<void> {
  assertCan(actor, "team.manage");
  await withActor(actor, async (tx) => {
    const [before] = await tx.select().from(jobTitles).where(eq(jobTitles.id, titleId));
    if (!before) throw new ServiceError("Job title not found.");
    if ((before.archivedAt !== null) === archived) return;
    await tx.update(jobTitles).set({ archivedAt: archived ? new Date() : null }).where(eq(jobTitles.id, titleId));
    await recordAudit(tx, { actorId: actor.id, entityType: "job_title", entityId: titleId, action: archived ? "job_title.archived" : "job_title.restored", after: { name: before.name }, request });
  });
}

/** A person's job title in this company (or none). */
export async function setMemberJobTitle(actor: Actor, userId: string, titleId: string | null, request?: RequestMeta): Promise<void> {
  assertCan(actor, "team.manage");
  await withActor(actor, async (tx) => {
    const where = and(eq(memberships.organizationId, actor.orgId), eq(memberships.userId, userId));
    const [member] = await tx.select({ jobTitleId: memberships.jobTitleId }).from(memberships).where(where);
    if (!member) throw new ServiceError("Member not found.");
    if (member.jobTitleId === titleId) return;
    let name: string | null = null;
    if (titleId) {
      const [title] = await tx.select().from(jobTitles).where(eq(jobTitles.id, titleId));
      if (!title) throw new ServiceError("Job title not found.");
      if (title.archivedAt) throw new ServiceError(`"${title.name}" is archived.`);
      name = title.name;
    }
    await tx.update(memberships).set({ jobTitleId: titleId }).where(where).catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "user", entityId: userId, action: "user.job_title_changed", after: { jobTitle: name }, request });
  });
}

// --- Team type (set-up) ---------------------------------------------------------------------

export const teamTypeInput = z.enum(TEAM_TYPES);

/**
 * "What kind of team are you?": remembers the answer and adds the suggested job titles and roles
 * the company doesn't have yet. Safe to run again.
 */
export async function applyTeamType(actor: Actor, raw: TeamType, request?: RequestMeta): Promise<{ titles: number; roles: number }> {
  assertCan(actor, "team.manage");
  assertCan(actor, "company.manage");
  const teamType = teamTypeInput.parse(raw);
  return withActor(actor, async (tx) => {
    // Phase 32: fintech teams get release approvals switched on (they can switch them off on the Company page).
    await tx
      .update(organizations)
      .set({ teamType, ...(teamType === "FINTECH" ? { releaseControl: true } : {}) })
      .where(eq(organizations.id, actor.orgId));
    const haveTitles = new Set((await tx.select({ name: jobTitles.name }).from(jobTitles)).map((r) => r.name.toLowerCase()));
    const titles = JOB_TITLE_PRESETS[teamType].filter((n) => !haveTitles.has(n.toLowerCase()));
    if (titles.length > 0) await tx.insert(jobTitles).values(titles.map((name) => ({ name })));
    const haveRoles = new Set((await tx.select({ name: companyRoles.name }).from(companyRoles)).map((r) => r.name.toLowerCase()));
    const roles = ROLE_PRESETS[teamType].filter((r) => !haveRoles.has(r.name.toLowerCase()));
    for (const r of roles) assertCanGrant(actor, { ...r, permissions: r.permissions });
    if (roles.length > 0) {
      await tx.insert(companyRoles).values(roles.map((r) => ({ name: r.name, description: r.description, baseRole: r.baseRole, permissions: r.permissions, createdBy: actor.id })));
    }
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "organization",
      entityId: actor.orgId,
      action: "company.team_type_set",
      after: { teamType, addedTitles: titles, addedRoles: roles.map((r) => r.name) },
      request,
    });
    return { titles: titles.length, roles: roles.length };
  });
}

/** Whether the company still needs to say what kind of team it is (no job titles yet). */
export async function needsTeamSetup(actor: Actor): Promise<boolean> {
  return withActor(actor, async (tx) => (await tx.select({ id: jobTitles.id }).from(jobTitles).limit(1)).length === 0);
}
