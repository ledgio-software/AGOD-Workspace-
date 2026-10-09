import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withActor } from "@/lib/db/actor";
import { articles, memberProfiles, organizations, sessions, users } from "@/lib/db/schema";
import { companiesOf, suspendedCompaniesOf } from "@/lib/session";
import { type Member, canModerate, ensureProfile } from "@/modules/community";
import { createArticle } from "@/modules/community/articles";
import {
  asStaff,
  getCompany,
  getPerson,
  health,
  hiddenItems,
  listCompanies,
  listOrganizers,
  listPeople,
  overview,
  platformLog,
  sendResetLink,
  setCompanySuspended,
  setLoginBlocked,
  setOrganizerRole,
} from "@/modules/platform";
import { createCompany, createSession, db, expectDbError } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 40: the AGOD back office.

async function person(name: string, verified = true): Promise<Member> {
  const id = randomUUID();
  const m = { id, name, email: `${id}@agod.test` };
  await db.insert(users).values({ ...m, emailVerified: verified });
  return m;
}

async function staffMember(verified = true) {
  const s = await person("Staff", verified);
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", `someone@else.test, ${s.email.toUpperCase()}`);
  return s;
}

describe("AGOD back office", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is only for staff in PLATFORM_ADMIN_EMAILS with a verified, active login", async () => {
    const outsider = await person("Outsider");
    const staff = await staffMember();
    expect(await asStaff(outsider)).toBeNull();
    expect(await asStaff(staff)).toEqual(staff);
    await expect(overview(outsider)).rejects.toThrow("Only AGOD back-office staff");
    await expect(listCompanies(outsider)).rejects.toThrow("Only AGOD back-office staff");
    await expect(setLoginBlocked(outsider, staff.id, true, "Testing access")).rejects.toThrow("Only AGOD back-office staff");

    const unverified = await person("Unverified staff", false);
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", unverified.email);
    expect(await asStaff(unverified)).toBeNull();
  });

  it("staff count as community organizers", async () => {
    const staff = await staffMember();
    expect(await canModerate(staff)).toBe(true);
    expect(await canModerate(await person("Plain member"))).toBe(false);
  });

  it("shows platform numbers and health checks", async () => {
    const staff = await staffMember();
    const o = await overview(staff);
    expect(o.people).toBeGreaterThan(0);
    expect(o.signupsByWeek).toHaveLength(8);
    const checks = await health(staff, { CRON_SECRET: "", PLATFORM_ADMIN_EMAILS: staff.email });
    expect(checks.find((c) => c.key === "database")!.state).toBe("ok");
    expect(checks.find((c) => c.key === "migrations")!.state).toBe("ok");
    expect(checks.find((c) => c.key === "daily")!.state).toBe("off");
    expect(checks.find((c) => c.key === "email")!.state).toBe("off");
  });

  it("lists companies as a summary and suspends and restores them, with the reason logged", async () => {
    const staff = await staffMember();
    const { org, owner } = await createCompany(`Suspend me ${randomUUID().slice(0, 4)}`);
    const found = (await listCompanies(staff, { q: org.name })).find((c) => c.id === org.id)!;
    expect(found).toMatchObject({ name: org.name, members: 1, admins: 1, projects: 0, suspendedAt: null });
    const detail = (await getCompany(staff, org.id))!;
    expect(detail.members.map((m) => m.userId)).toEqual([owner.id]);
    expect(Object.keys(detail.company)).not.toContain("invoices");

    await expect(setCompanySuspended(staff, org.id, true, "no")).rejects.toThrow("Give a reason");
    expect((await companiesOf(owner.id)).map((c) => c.id)).toContain(org.id);
    await setCompanySuspended(staff, org.id, true, "Unpaid platform fees");
    // Its members lose the company (they keep the community); nothing else changes.
    expect((await companiesOf(owner.id)).map((c) => c.id)).not.toContain(org.id);
    expect(await suspendedCompaniesOf(owner.id)).toEqual([org.name]);
    expect((await listCompanies(staff, { status: "suspended" })).map((c) => c.id)).toContain(org.id);
    await expect(setCompanySuspended(staff, org.id, true, "Again please")).rejects.toThrow("already suspended");

    // The company's own Admin can't lift it through the app's database role.
    await expectDbError(
      withActor(owner, (tx) => tx.update(organizations).set({ suspendedAt: null, suspendedReason: null }).where(eq(organizations.id, org.id))),
      /Only the AGOD back office/,
    );

    await setCompanySuspended(staff, org.id, false, "Fees paid");
    expect((await companiesOf(owner.id)).map((c) => c.id)).toContain(org.id);
    expect(await suspendedCompaniesOf(owner.id)).toEqual([]);
    const log = (await getCompany(staff, org.id))!.log;
    expect(log.map((l) => [l.action, l.reason, l.actor])).toEqual([
      ["COMPANY_RESTORED", "Fees paid", "Staff"],
      ["COMPANY_SUSPENDED", "Unpaid platform fees", "Staff"],
    ]);
  });

  it("blocks a login (signing them out) and restores it, but never your own or another staff member's", async () => {
    const staff = await staffMember();
    const target = await person(`Target ${randomUUID().slice(0, 4)}`);
    await createSession(target.id);
    const listed = (await listPeople(staff, { q: target.email })).people;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: target.id, active: true, staff: false });

    await setLoginBlocked(staff, target.id, true, "Spam account");
    const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, target.id));
    expect(u.active).toBe(false);
    expect(await db.select().from(sessions).where(eq(sessions.userId, target.id))).toHaveLength(0);
    expect((await listPeople(staff, { status: "blocked", q: target.email })).people).toHaveLength(1);
    await expect(sendResetLink(staff, target.id)).rejects.toThrow("blocked");

    await expect(setLoginBlocked(staff, staff.id, true, "Testing myself")).rejects.toThrow("your own login");
    const other = await person("Other staff");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", `${staff.email},${other.email}`);
    await expect(setLoginBlocked(staff, other.id, true, "Testing staff")).rejects.toThrow("Back-office staff can't be blocked");

    await setLoginBlocked(staff, target.id, false, "Was a mistake");
    const detail = (await getPerson(staff, target.id))!;
    expect(detail.active).toBe(true);
    expect(detail.log.map((l) => l.action)).toEqual(["LOGIN_RESTORED", "LOGIN_BLOCKED"]);
    // Without email set up, no reset link can be sent.
    await expect(sendResetLink(staff, target.id)).rejects.toThrow("Email isn't set up");
  });

  it("lists hidden content and manages organizers", async () => {
    const staff = await staffMember();
    await ensureProfile(staff);
    const author = await person(`Author ${randomUUID().slice(0, 4)}`);
    await ensureProfile(author);
    await db.update(memberProfiles).set({ conductAcceptedAt: new Date() }).where(eq(memberProfiles.userId, author.id));
    const id = await createArticle(author, { title: `Hidden article ${randomUUID().slice(0, 4)}`, summary: "Something that got reported.", body: "A long enough body for the article to be valid here.", tags: "" });
    await db.update(articles).set({ hiddenAt: new Date(), hiddenBy: staff.id, hiddenReason: "Spam" }).where(eq(articles.id, id));
    const hidden = (await hiddenItems(staff)).find((h) => h.id === id)!;
    expect(hidden).toMatchObject({ kind: "Article", link: `/articles/${id}`, reason: "Spam", hiddenBy: "Staff" });

    const [p] = await db.select({ handle: memberProfiles.handle }).from(memberProfiles).where(eq(memberProfiles.userId, author.id));
    await setOrganizerRole(staff, `https://site.example/members/${p.handle}`, true);
    expect((await listOrganizers(staff)).find((o) => o.email === author.email)).toMatchObject({ via: "role", handle: p.handle });
    expect((await listOrganizers(staff)).find((o) => o.email === staff.email)).toMatchObject({ via: "staff" });
    await setOrganizerRole(staff, p.handle, false);
    expect((await listOrganizers(staff)).some((o) => o.email === author.email)).toBe(false);

    const log = await platformLog(staff);
    expect(log.slice(0, 2).map((l) => l.action)).toEqual(["ORGANIZER_REMOVED", "ORGANIZER_ADDED"]);
  });
});
