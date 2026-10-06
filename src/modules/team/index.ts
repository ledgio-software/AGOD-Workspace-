import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { accounts, memberships, orgMembers, organizations, sessions, users } from "@/lib/db/schema";
import { emailConfig } from "@/lib/email";
import { type Actor, type Role, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { appUrl, createPasswordLink, sendAccountEmail } from "@/modules/accounts";
import { addedToCompanyMessage, inviteMessage, resetPasswordMessage } from "@/modules/email/account";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";

export const ROLES = ["TEAM_MEMBER", "PROJECT_MANAGER", "ADMIN"] as const satisfies readonly Role[];

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  weeklyCapacityHours: number;
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
export const capacityInput = z.object({
  userId: z.uuid(),
  hours: z.coerce.number().int("Whole hours").min(0, "0 to 80 hours").max(80, "0 to 80 hours"),
});

/** A one-time password the Admin passes to the member, who changes it after signing in. */
export function generateTemporaryPassword(): string {
  return `Agod-${randomBytes(12).toString("base64url")}`;
}

// Phase 22: the team is the current company's members (role, active and capacity are per company).
const memberColumns = {
  id: orgMembers.id,
  name: orgMembers.name,
  email: orgMembers.email,
  phone: orgMembers.phone,
  role: orgMembers.role,
  active: orgMembers.active,
  weeklyCapacityHours: orgMembers.weeklyCapacityHours,
  createdAt: orgMembers.createdAt,
};

const thisMembership = (actor: Actor, userId: string) => and(eq(memberships.organizationId, actor.orgId), eq(memberships.userId, userId));

export async function listTeam(actor: Actor): Promise<TeamMember[]> {
  assertCan(actor, "team.view");
  return withActor(actor, (tx) => tx.select(memberColumns).from(orgMembers).orderBy(asc(orgMembers.name)));
}

export async function createMember(
  actor: Actor,
  rawInput: z.input<typeof createMemberInput>,
  request?: RequestMeta,
): Promise<{ member: TeamMember; temporaryPassword: string | null; emailed: boolean; existing: boolean }> {
  assertCan(actor, "team.manage");
  const input = createMemberInput.parse(rawInput);
  // Phase 23: with email set up, people get an email (an invitation with a link to choose their
  // password, or a note that they were added); otherwise the Admin passes on a temporary password.
  const viaEmail = emailConfig() !== null;

  // Someone with a login already (e.g. in another company) is added with their own password.
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, input.email));
  if (existing) {
    const member = await withActor(actor, async (tx) => {
      const [already] = await tx.select({ id: memberships.id }).from(memberships).where(thisMembership(actor, existing.id));
      if (already) throw new ServiceError("This person is already in the team. Reactivate them instead.");
      await tx.insert(memberships).values({ organizationId: actor.orgId, userId: existing.id, role: input.role }).catch(rethrowDbGuard);
      await recordAudit(tx, {
        actorId: actor.id,
        entityType: "user",
        entityId: existing.id,
        action: "user.added",
        after: { email: input.email, role: input.role },
        request,
      });
      return loadMember(tx, existing.id);
    });
    const emailed = viaEmail && (await notify(actor, member, (who) => addedToCompanyMessage({ name: member.name, ...who, url: appUrl("/sign-in") })));
    return { member, temporaryPassword: null, emailed, existing: true };
  }

  const temporaryPassword = viaEmail ? null : generateTemporaryPassword();
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;
  const member = await withActor(actor, async (tx) => {
    // No RETURNING: the new person is only visible to this company once their membership exists.
    const created = { id: randomUUID(), name: input.name, email: input.email };
    await tx.insert(users).values({ ...created, emailVerified: true });
    await tx.insert(memberships).values({ organizationId: actor.orgId, userId: created.id, role: input.role });
    // Invited by email: no password yet; they choose one with the link.
    if (passwordHash) {
      await tx.insert(accounts).values({
        userId: created.id,
        accountId: created.id,
        providerId: "credential",
        password: passwordHash,
      });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "user",
      entityId: created.id,
      action: "user.created",
      after: { name: created.name, email: created.email, role: input.role },
      request,
    });
    return loadMember(tx, created.id);
  });
  if (!viaEmail) return { member, temporaryPassword, emailed: false, existing: false };
  const url = await createPasswordLink(member.id);
  await notify(actor, member, (who) => inviteMessage({ name: member.name, ...who, url }));
  return { member, temporaryPassword: null, emailed: true, existing: false };
}

/** Emails a person about this company; a failure is reported, with how to send it again. */
async function notify(
  actor: Actor,
  member: { name: string; email: string },
  build: (who: { company: string; invitedBy: string }) => { subject: string; text: string; html: string },
): Promise<boolean> {
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, actor.orgId));
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.id));
  try {
    return await sendAccountEmail(member.email, build({ company: org.name, invitedBy: me.name }));
  } catch (error) {
    throw new ServiceError(
      `${member.name} was added, but the email could not be sent (${error instanceof Error ? error.message : "unknown error"}). Use “Send a password link” on the Team page to try again.`,
    );
  }
}

async function loadMember(tx: Parameters<Parameters<typeof withActor>[1]>[0], userId: string) {
  const [member] = await tx.select(memberColumns).from(orgMembers).where(eq(orgMembers.id, userId));
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
    await tx.update(memberships).set({ role: input.role }).where(thisMembership(actor, input.userId)).catch(rethrowDbGuard);
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
    // Only this company: access ends on their next page load; other companies are unaffected.
    await tx.update(memberships).set({ active: input.active }).where(thisMembership(actor, input.userId)).catch(rethrowDbGuard);
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
): Promise<{ temporaryPassword: string | null; emailed: boolean }> {
  assertCan(actor, "team.manage");
  const input = resetPasswordInput.parse(rawInput);
  // Phase 23: with email set up, the person gets a link at their own address (safe for anyone,
  // even people in several companies, since only they can open it).
  if (emailConfig()) {
    const member = await withActor(actor, (tx) => loadMember(tx, input.userId));
    const [credential] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, input.userId), eq(accounts.providerId, "credential")));
    const url = await createPasswordLink(input.userId, credential ? 1 : 7);
    await notify(actor, member, (who) =>
      credential ? resetPasswordMessage({ name: member.name, url }) : inviteMessage({ name: member.name, ...who, url }),
    );
    await withActor(actor, (tx) =>
      recordAudit(tx, { actorId: actor.id, entityType: "user", entityId: input.userId, action: "user.password_link_sent", request }),
    );
    return { temporaryPassword: null, emailed: true };
  }
  // A login shared with another company is that person's own: no company may take it over.
  const [elsewhere] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, input.userId), ne(memberships.organizationId, actor.orgId)));
  if (elsewhere) throw new ServiceError("This person also works with another company, so only they can change their password.");
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

  return { temporaryPassword, emailed: false };
}

/** Roadmap 2.6: hours a week a person has for project work (0 for someone on leave). */
export async function setCapacity(actor: Actor, rawInput: z.input<typeof capacityInput>, request?: RequestMeta): Promise<void> {
  assertCan(actor, "team.manage");
  const input = capacityInput.parse(rawInput);
  await withActor(actor, async (tx) => {
    const member = await loadMember(tx, input.userId);
    if (member.weeklyCapacityHours === input.hours) return;
    await tx.update(memberships).set({ weeklyCapacityHours: input.hours }).where(thisMembership(actor, input.userId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "user",
      entityId: input.userId,
      action: "user.capacity_changed",
      before: { weeklyCapacityHours: member.weeklyCapacityHours },
      after: { weeklyCapacityHours: input.hours },
      request,
    });
  });
}
