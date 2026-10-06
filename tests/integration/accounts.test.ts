import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accounts, memberships, organizations, projectTemplates, users, verifications } from "@/lib/db/schema";
import { createPasswordLink, finishSignUp, signupOpen } from "@/modules/accounts";
import { createMember, resetPassword } from "@/modules/team";
import { createCompany, createUser, db } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 23: self sign-up (company created on email confirmation) and email invitations.

let outbox = "";
const mails = () =>
  readdirSync(outbox)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(outbox, f), "utf8")) as { to: string; subject: string; text: string });

beforeEach(() => {
  outbox = mkdtempSync(path.join(tmpdir(), "agod-outbox-"));
  vi.stubEnv("EMAIL_OUTBOX_DIR", outbox);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());

async function signedUp(pendingCompany: string | null) {
  const id = randomUUID();
  await db.insert(users).values({ id, name: "Kwame Asante", email: `${id}@agod.test`, emailVerified: true, pendingCompany });
  return id;
}

describe("sign-up", () => {
  it("is open only with ALLOW_SIGNUP=true and working email", () => {
    expect(signupOpen({ ALLOW_SIGNUP: "true", EMAIL_OUTBOX_DIR: "/tmp/x" })).toBe(true);
    expect(signupOpen({ ALLOW_SIGNUP: "true" })).toBe(false);
    expect(signupOpen({ EMAIL_OUTBOX_DIR: "/tmp/x" })).toBe(false);
  });

  it("creates the named company with the person as Admin once, when the email is confirmed", async () => {
    const userId = await signedUp(`Vibe Studio ${randomUUID().slice(0, 6)}`);
    const orgId = await finishSignUp(userId);
    expect(orgId).toBeTruthy();
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, userId));
    expect(m).toMatchObject({ organizationId: orgId, role: "ADMIN", active: true });
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId!));
    expect(org.projectCodePrefix).toBe("VIBE");
    expect((await db.select().from(projectTemplates).where(eq(projectTemplates.organizationId, orgId!))).length).toBeGreaterThan(0);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user.pendingCompany).toBeNull();
    // Confirming again (or a second link) does nothing more.
    expect(await finishSignUp(userId)).toBeNull();
    expect(await db.select().from(memberships).where(eq(memberships.userId, userId))).toHaveLength(1);
  });

  it("does nothing without a company name, or for someone already in a company", async () => {
    expect(await finishSignUp(await signedUp(null))).toBeNull();
    const member = await createUser("TEAM_MEMBER");
    await db.update(users).set({ pendingCompany: "Second company" }).where(eq(users.id, member.id));
    expect(await finishSignUp(member.id)).toBeNull();
    expect(await db.select().from(memberships).where(eq(memberships.userId, member.id))).toHaveLength(1);
  });
});

describe("invitations by email", () => {
  it("invites a new person with a link instead of a temporary password", async () => {
    const admin = await createUser("ADMIN");
    const email = `invitee-${randomUUID()}@agod.test`;
    const result = await createMember(admin, { name: "Efua Owusu", email, role: "TEAM_MEMBER" });
    expect(result).toMatchObject({ temporaryPassword: null, emailed: true, existing: false });
    // No password until they choose one.
    expect(await db.select().from(accounts).where(eq(accounts.userId, result.member.id))).toHaveLength(0);
    const [mail] = mails().filter((m) => m.to === email);
    expect(mail.subject).toMatch(/invited you to Test company/);
    const link = mail.text.match(/http:\/\/localhost:3000\/api\/auth\/reset-password\/([A-Za-z0-9_-]+)\?callbackURL=\S+/);
    expect(link).toBeTruthy();
    const [token] = await db.select().from(verifications).where(eq(verifications.identifier, `reset-password:${link![1]}`));
    expect(token.value).toBe(result.member.id);
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it("tells someone who already has a login that they were added", async () => {
    const admin = await createUser("ADMIN");
    const { owner } = await createCompany();
    const person = await createUser("TEAM_MEMBER");
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, person.id));
    const result = await createMember(owner, { name: "Shared Person", email: row.email, role: "TEAM_MEMBER" });
    expect(result).toMatchObject({ temporaryPassword: null, emailed: true, existing: true });
    expect(mails().find((m) => m.to === row.email)?.subject).toMatch(/You were added to/);
    expect(admin).toBeTruthy();
  });

  it("emails a password link even to people in several companies (only they can open it)", async () => {
    const { owner } = await createCompany();
    const person = await createUser("TEAM_MEMBER");
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, person.id));
    await createMember(owner, { name: "Shared Person", email: row.email, role: "TEAM_MEMBER" });
    const result = await resetPassword(owner, { userId: person.id });
    expect(result).toEqual({ temporaryPassword: null, emailed: true, emailError: null });
    // They never chose a password, so this is an invitation-style email with the link.
    expect(mails().some((m) => m.to === row.email && m.text.includes("/api/auth/reset-password/"))).toBe(true);
    const tokens = await db.select().from(verifications).where(and(eq(verifications.value, person.id), like(verifications.identifier, "reset-password:%")));
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("makes single-use links that expire", async () => {
    const userId = await signedUp(null);
    const url = await createPasswordLink(userId, 1);
    expect(url).toMatch(/^http:\/\/localhost:3000\/api\/auth\/reset-password\/[A-Za-z0-9_-]{32}\?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Freset-password%3Fwelcome%3D1$/);
  });
});

describe("Phase 28: a password reset confirms the email", () => {
  it("someone who never confirmed can sign in after choosing a password from the link, and gets their company", async () => {
    const id = randomUUID();
    const email = `${id}@agod.test`;
    await db.insert(users).values({ id, name: "Sandra Owusu", email, emailVerified: false, pendingCompany: `Sandra Studio ${id.slice(0, 4)}` });
    const token = (await createPasswordLink(id, 1)).match(/reset-password\/([A-Za-z0-9_-]+)/)![1];
    const { auth } = await import("@/lib/auth");
    await auth.api.resetPassword({ body: { newPassword: "A-new-password-123", token } });
    const [user] = await db.select({ verified: users.emailVerified }).from(users).where(eq(users.id, id));
    expect(user.verified).toBe(true);
    const [membership] = await db.select().from(memberships).where(eq(memberships.userId, id));
    expect(membership?.role).toBe("ADMIN");
    const session = await auth.api.signInEmail({ body: { email, password: "A-new-password-123" } });
    expect(session.user.id).toBe(id);
  });
});

describe("when the mail server refuses (e.g. a wrong Gmail password)", () => {
  // A closed port: every send fails straight away, like a refused login.
  const brokenMail = () => {
    vi.stubEnv("EMAIL_OUTBOX_DIR", "");
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    vi.stubEnv("SMTP_PORT", "1");
    vi.stubEnv("EMAIL_FROM", "team@agod.test");
  };

  it("gives a new person a temporary password instead of leaving them without a way in", async () => {
    const admin = await createUser("ADMIN");
    brokenMail();
    const email = `nomail-${randomUUID()}@agod.test`;
    const result = await createMember(admin, { name: "Sandra Mensah", email, role: "TEAM_MEMBER" });
    expect(result).toMatchObject({ emailed: false, existing: false });
    expect(result.emailError).toMatch(/mail server refused/);
    expect(result.temporaryPassword).toMatch(/.{12,}/);
    expect(await db.select().from(accounts).where(eq(accounts.userId, result.member.id))).toHaveLength(1);
  });

  it("falls back to a temporary password for a password link, except for people in another company", async () => {
    const admin = await createUser("ADMIN");
    const person = await createUser("TEAM_MEMBER");
    brokenMail();
    const reset = await resetPassword(admin, { userId: person.id });
    expect(reset.emailed).toBe(false);
    expect(reset.emailError).toMatch(/mail server refused/);
    expect(reset.temporaryPassword).toBeTruthy();

    const { owner } = await createCompany();
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, person.id));
    await createMember(owner, { name: "Shared Person", email: row.email, role: "TEAM_MEMBER" });
    await expect(resetPassword(admin, { userId: person.id })).rejects.toThrow(/could not be sent.*Forgot password/);
  });
});
