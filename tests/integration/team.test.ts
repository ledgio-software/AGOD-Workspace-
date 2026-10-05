import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, auditEvents, sessions, users } from "@/lib/db/schema";
import { PermissionError } from "@/lib/permissions";
import { ServiceError } from "@/modules/errors";
import { changeRole, createMember, listTeam, resetPassword, setActive } from "@/modules/team";
import { createSession, createUser, db } from "./fixtures";

const newEmail = () => `new-${crypto.randomUUID()}@agod.test`;

describe("team management permissions", () => {
  it("team members cannot view the team list", async () => {
    const member = await createUser("TEAM_MEMBER");
    await expect(listTeam(member)).rejects.toThrow(PermissionError);
  });

  it("project managers can view but not manage the team", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const target = await createUser("TEAM_MEMBER");
    expect((await listTeam(pm)).some((m) => m.id === target.id)).toBe(true);
    await expect(createMember(pm, { name: "X", email: newEmail(), role: "TEAM_MEMBER" })).rejects.toThrow(
      PermissionError,
    );
    await expect(changeRole(pm, { userId: target.id, role: "ADMIN", reason: "promote" })).rejects.toThrow(
      PermissionError,
    );
    await expect(setActive(pm, { userId: target.id, active: false, reason: "left" })).rejects.toThrow(
      PermissionError,
    );
    await expect(resetPassword(pm, { userId: target.id })).rejects.toThrow(PermissionError);
  });

  it("the database rejects an Admin whose account was deactivated (RLS second layer)", async () => {
    const formerAdmin = await createUser("ADMIN", { active: false });
    // The service-level check passes (stale role in hand); row-level security still refuses.
    await expect(
      createMember(formerAdmin, { name: "X", email: newEmail(), role: "TEAM_MEMBER" }),
    ).rejects.toThrow();
  });
});

describe("team management by an Admin", () => {
  it("creates a member with a working temporary password and an audit event", async () => {
    const admin = await createUser("ADMIN");
    const email = newEmail();
    const { member, temporaryPassword } = await createMember(admin, {
      name: "Ama Mensah",
      email: email.toUpperCase(),
      role: "TEAM_MEMBER",
    });

    expect(member.email).toBe(email);
    const [account] = await db.select().from(accounts).where(eq(accounts.userId, member.id));
    expect(await verifyPassword({ hash: account.password!, password: temporaryPassword })).toBe(true);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, member.id), eq(auditEvents.action, "user.created")));
    expect(event.actorId).toBe(admin.id);
    expect(JSON.stringify(event.afterJson)).not.toContain(temporaryPassword);
  });

  it("rejects a duplicate email regardless of case", async () => {
    const admin = await createUser("ADMIN");
    const email = newEmail();
    await createMember(admin, { name: "First", email, role: "TEAM_MEMBER" });
    await expect(
      createMember(admin, { name: "Second", email: email.toUpperCase(), role: "TEAM_MEMBER" }),
    ).rejects.toThrow(ServiceError);
  });

  it("changes a role with a reason and audits before/after", async () => {
    const admin = await createUser("ADMIN");
    const target = await createUser("TEAM_MEMBER");
    await changeRole(admin, { userId: target.id, role: "PROJECT_MANAGER", reason: "Leads the payroll project" });

    const [user] = await db.select().from(users).where(eq(users.id, target.id));
    expect(user.role).toBe("PROJECT_MANAGER");
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, target.id), eq(auditEvents.action, "user.role_changed")));
    expect(event.beforeJson).toEqual({ role: "TEAM_MEMBER" });
    expect(event.afterJson).toEqual({ role: "PROJECT_MANAGER" });
    expect(event.reason).toBe("Leads the payroll project");
  });

  it("requires a reason for role changes", async () => {
    const admin = await createUser("ADMIN");
    const target = await createUser("TEAM_MEMBER");
    await expect(changeRole(admin, { userId: target.id, role: "ADMIN", reason: "" })).rejects.toThrow();
  });

  it("prevents Admins from changing their own role or deactivating themselves", async () => {
    const admin = await createUser("ADMIN");
    await expect(changeRole(admin, { userId: admin.id, role: "TEAM_MEMBER", reason: "oops" })).rejects.toThrow(
      ServiceError,
    );
    await expect(setActive(admin, { userId: admin.id, active: false, reason: "oops" })).rejects.toThrow(
      ServiceError,
    );
  });

  it("deactivation signs the member out; history and reactivation still work", async () => {
    const admin = await createUser("ADMIN");
    const target = await createUser("TEAM_MEMBER");
    await createSession(target.id);

    await setActive(admin, { userId: target.id, active: false, reason: "Contract ended" });
    expect(await db.select().from(sessions).where(eq(sessions.userId, target.id))).toHaveLength(0);
    expect((await listTeam(admin)).find((m) => m.id === target.id)?.active).toBe(false);

    await setActive(admin, { userId: target.id, active: true, reason: "Rejoined" });
    const actions = (
      await db.select().from(auditEvents).where(eq(auditEvents.entityId, target.id))
    ).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["user.deactivated", "user.reactivated"]));
  });

  it("resets a password and revokes existing sessions", async () => {
    const admin = await createUser("ADMIN");
    const { member } = await createMember(admin, { name: "Kofi", email: newEmail(), role: "TEAM_MEMBER" });
    await createSession(member.id);

    const { temporaryPassword } = await resetPassword(admin, { userId: member.id });
    const [account] = await db.select().from(accounts).where(eq(accounts.userId, member.id));
    expect(await verifyPassword({ hash: account.password!, password: temporaryPassword })).toBe(true);
    expect(await db.select().from(sessions).where(eq(sessions.userId, member.id))).toHaveLength(0);
  });
});
