import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/lib/db/actor";
import { accounts, sessions, users } from "@/lib/db/schema";
import { type Actor, type Role, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError } from "@/modules/errors";

export const ROLES = ["TEAM_MEMBER", "PROJECT_MANAGER", "ADMIN"] as const satisfies readonly Role[];

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  createdAt: Date;
};

const reason = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500);

export const createMemberInput = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  email: z.email("Enter a valid email").trim().toLowerCase(),
  role: z.enum(ROLES),
});

export const changeRoleInput = z.object({ userId: z.uuid(), role: z.enum(ROLES), reason });
export const setActiveInput = z.object({ userId: z.uuid(), active: z.boolean(), reason });
export const resetPasswordInput = z.object({ userId: z.uuid() });

/** A one-time password the Admin passes to the member, who changes it after signing in. */
export function generateTemporaryPassword(): string {
  return `Agod-${randomBytes(12).toString("base64url")}`;
}

const memberColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  role: users.role,
  active: users.active,
  createdAt: users.createdAt,
};

export async function listTeam(actor: Actor): Promise<TeamMember[]> {
  assertCan(actor, "team.view");
  return withActor(actor, (tx) =>
    tx.select(memberColumns).from(users).orderBy(asc(users.name)),
  );
}

export async function createMember(
  actor: Actor,
  rawInput: z.input<typeof createMemberInput>,
  request?: RequestMeta,
): Promise<{ member: TeamMember; temporaryPassword: string }> {
  assertCan(actor, "team.manage");
  const input = createMemberInput.parse(rawInput);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const member = await withActor(actor, async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email));
    if (existing) throw new ServiceError("A member with this email already exists.");

    const [created] = await tx
      .insert(users)
      .values({ name: input.name, email: input.email, role: input.role, emailVerified: true })
      .returning(memberColumns);
    await tx.insert(accounts).values({
      userId: created.id,
      accountId: created.id,
      providerId: "credential",
      password: passwordHash,
    });
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "user",
      entityId: created.id,
      action: "user.created",
      after: { name: created.name, email: created.email, role: created.role },
      request,
    });
    return created;
  });

  return { member, temporaryPassword };
}

async function loadMember(tx: Parameters<Parameters<typeof withActor>[1]>[0], userId: string) {
  const [member] = await tx.select(memberColumns).from(users).where(eq(users.id, userId));
  if (!member) throw new ServiceError("Member not found.");
  return member;
}

export async function changeRole(
  actor: Actor,
  rawInput: z.input<typeof changeRoleInput>,
  request?: RequestMeta,
): Promise<void> {
  assertCan(actor, "team.manage");
  const input = changeRoleInput.parse(rawInput);
  if (input.userId === actor.id) {
    throw new ServiceError("You cannot change your own role. Ask another Admin.");
  }

  await withActor(actor, async (tx) => {
    const member = await loadMember(tx, input.userId);
    if (member.role === input.role) return;
    await tx.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "user",
      entityId: input.userId,
      action: "user.role_changed",
      before: { role: member.role },
      after: { role: input.role },
      reason: input.reason,
      request,
    });
  });
}

export async function setActive(
  actor: Actor,
  rawInput: z.input<typeof setActiveInput>,
  request?: RequestMeta,
): Promise<void> {
  assertCan(actor, "team.manage");
  const input = setActiveInput.parse(rawInput);
  if (input.userId === actor.id) {
    throw new ServiceError("You cannot deactivate your own account.");
  }

  await withActor(actor, async (tx) => {
    const member = await loadMember(tx, input.userId);
    if (member.active === input.active) return;
    await tx.update(users).set({ active: input.active }).where(eq(users.id, input.userId));
    // Deactivation signs the member out everywhere immediately.
    if (!input.active) await tx.delete(sessions).where(eq(sessions.userId, input.userId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "user",
      entityId: input.userId,
      action: input.active ? "user.reactivated" : "user.deactivated",
      before: { active: member.active },
      after: { active: input.active },
      reason: input.reason,
      request,
    });
  });
}

export async function resetPassword(
  actor: Actor,
  rawInput: z.input<typeof resetPasswordInput>,
  request?: RequestMeta,
): Promise<{ temporaryPassword: string }> {
  assertCan(actor, "team.manage");
  const input = resetPasswordInput.parse(rawInput);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await withActor(actor, async (tx) => {
    await loadMember(tx, input.userId);
    const updated = await tx
      .update(accounts)
      .set({ password: passwordHash })
      .where(and(eq(accounts.userId, input.userId), eq(accounts.providerId, "credential")))
      .returning({ id: accounts.id });
    if (updated.length === 0) {
      await tx.insert(accounts).values({
        userId: input.userId,
        accountId: input.userId,
        providerId: "credential",
        password: passwordHash,
      });
    }
    await tx.delete(sessions).where(eq(sessions.userId, input.userId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "user",
      entityId: input.userId,
      action: "user.password_reset",
      request,
    });
  });

  return { temporaryPassword };
}
