import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withActor } from "@/lib/db/actor";
import { communityReports, memberProfiles, users } from "@/lib/db/schema";
import {
  type Member,
  acceptConduct,
  canModerate,
  communityStats,
  ensureProfile,
  getProfile,
  handleFrom,
  listMembers,
  listReports,
  onboarding,
  reportProfile,
  resolveReport,
  setOrganizer,
  unhideProfile,
  updateProfile,
  welcomeNewMember,
} from "@/modules/community";
import { createUser, db, expectDbError } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 25: community members (no company needed), profiles, the directory, reports and organizers.

afterEach(() => vi.unstubAllEnvs());

/** A signed-up person with no company. */
async function newMember(name = "Ama Mensah"): Promise<Member> {
  const id = randomUUID();
  const email = `${id}@agod.test`;
  await db.insert(users).values({ id, name, email, emailVerified: true });
  return { id, name, email };
}

const base = {
  handle: "",
  headline: "",
  bio: "",
  city: "",
  tools: "",
  websiteUrl: "",
  githubUrl: "",
  linkedinUrl: "",
  xUrl: "",
  reviewer: false,
  wantsMentor: false,
  visibility: "PUBLIC" as const,
};

async function organizer() {
  const m = await newMember("Kofi Organizer");
  await ensureProfile(m);
  await db.update(memberProfiles).set({ communityRole: "ORGANIZER" }).where(eq(memberProfiles.userId, m.id));
  return m;
}

describe("profiles", () => {
  it("are created on first use with a unique address from the name", async () => {
    expect(handleFrom("Ama Mensah")).toBe("ama-mensah");
    expect(handleFrom("Kwàme  O'Brien!")).toBe("kwame-o-brien");
    expect(handleFrom("Jo")).toBe("member-jo");
    const name = `Efua ${randomUUID().slice(0, 6)}`;
    const a = await ensureProfile(await newMember(name));
    const b = await ensureProfile(await newMember(name));
    expect(a.handle).toBe(handleFrom(name));
    expect(b.handle).not.toBe(a.handle);
    expect(b.handle.startsWith(handleFrom(name))).toBe(true);
    // Same person again: the same profile.
    const again = await ensureProfile({ id: a.userId, name, email: "x@agod.test" });
    expect(again.handle).toBe(a.handle);
  });

  it("are edited with checked links, tools and address", async () => {
    const m = await newMember();
    const p = await ensureProfile(m);
    const saved = await updateProfile(m, {
      ...base,
      handle: `Ama-${p.handle.length}${randomUUID().slice(0, 4)}`.toLowerCase(),
      headline: "  Mobile money apps with Lovable  ",
      city: "Kumasi",
      tools: "Claude, Cursor, , Claude, Next.js",
      githubUrl: "github.com/ama",
      websiteUrl: "http://ama.dev",
      reviewer: true,
    });
    expect(saved).toMatchObject({ headline: "Mobile money apps with Lovable", city: "Kumasi", tools: ["Claude", "Cursor", "Next.js"], githubUrl: "https://github.com/ama", websiteUrl: "https://ama.dev", reviewer: true, linkedinUrl: null, bio: null });
    expect(onboarding(saved)).toEqual({ conduct: false, profile: true });

    await expect(updateProfile(m, { ...base, handle: "-bad-" })).rejects.toThrow(/Profile address/);
    await expect(updateProfile(m, { ...base, handle: saved.handle, githubUrl: "not a link" })).rejects.toThrow(/web address/);
    await expect(updateProfile(m, { ...base, handle: saved.handle, tools: Array.from({ length: 16 }, (_, i) => `t${i}`).join(",") })).rejects.toThrow(/15 tools/);
    const other = await ensureProfile(await newMember("Someone Else"));
    await expect(updateProfile(m, { ...base, handle: other.handle })).rejects.toThrow(/taken/);
    // The database refuses what the form would (e.g. a script writing directly).
    await expect(db.update(memberProfiles).set({ websiteUrl: "javascript:alert(1)" }).where(eq(memberProfiles.userId, m.id))).rejects.toThrow();
  });

  it("record the code of conduct (at sign-up confirmation or on the community page)", async () => {
    const signedUp = await newMember();
    await welcomeNewMember(signedUp);
    expect(onboarding(await ensureProfile(signedUp)).conduct).toBe(true);
    const invited = await newMember();
    expect(onboarding(await ensureProfile(invited)).conduct).toBe(false);
    await acceptConduct(invited);
    expect(onboarding(await ensureProfile(invited)).conduct).toBe(true);
  });

  it("company members are community members too, visible to members only until they choose", async () => {
    const actor = await createUser("TEAM_MEMBER");
    const [row] = await db.select().from(users).where(eq(users.id, actor.id));
    const p = await ensureProfile({ id: actor.id, name: row.name, email: row.email });
    expect(p).toMatchObject({ communityRole: "BUILDER", visibility: "MEMBERS" });
    const joined = await newMember();
    await welcomeNewMember(joined);
    expect((await ensureProfile(joined)).visibility).toBe("PUBLIC");
  });
});

describe("the member directory", () => {
  it("shows visitors public profiles only, and members everyone not hidden", async () => {
    const tag = `tool${randomUUID().slice(0, 8)}`;
    const pub = await newMember("Public Builder");
    const priv = await newMember("Private Builder");
    const hidden = await newMember("Hidden Builder");
    const viewer = await newMember("Viewer");
    for (const [m, extra] of [
      [pub, { reviewer: true, city: "Accra" }],
      [priv, { visibility: "MEMBERS" as const, city: "Tamale" }],
      [hidden, {}],
    ] as const) {
      const p = await ensureProfile(m);
      await updateProfile(m, { ...base, handle: p.handle, tools: `${tag}, Flutter`, ...extra });
    }
    const org = await organizer();
    await db.update(memberProfiles).set({ hiddenAt: new Date(), hiddenBy: org.id }).where(eq(memberProfiles.userId, hidden.id));

    const names = async (v: Member | null, f: Parameters<typeof listMembers>[1] = {}) => (await listMembers(v, { q: tag, ...f })).members.map((m) => m.name).sort();
    expect(await names(null)).toEqual(["Public Builder"]);
    expect(await names(viewer)).toEqual(["Private Builder", "Public Builder"]);
    expect(await names(viewer, { city: "tamale" })).toEqual(["Private Builder"]);
    expect(await names(viewer, { reviewers: true })).toEqual(["Public Builder"]);
    expect(await names(viewer, { q: "%" })).not.toContain("Hidden Builder");

    const pubHandle = (await ensureProfile(pub)).handle;
    const privHandle = (await ensureProfile(priv)).handle;
    const hiddenHandle = (await ensureProfile(hidden)).handle;
    expect(await getProfile(pubHandle, null)).toMatchObject({ name: "Public Builder", self: false, organizer: false });
    expect(await getProfile(privHandle, null)).toBeNull();
    expect(await getProfile(privHandle, viewer)).not.toBeNull();
    expect(await getProfile(hiddenHandle, viewer)).toBeNull();
    expect(await getProfile(hiddenHandle, hidden)).toMatchObject({ self: true });
    expect(await getProfile(hiddenHandle, org)).toMatchObject({ organizer: true });
    expect(await getProfile("../etc", viewer)).toBeNull();

    // A deactivated login disappears from the community.
    await db.update(users).set({ active: false }).where(eq(users.id, pub.id));
    expect(await names(null)).toEqual([]);
    expect(await getProfile(pubHandle, viewer)).toBeNull();

    const stats = await communityStats();
    expect(stats.members).toBeGreaterThan(0);
  });
});

describe("reports and organizers", () => {
  it("members report profiles; organizers hide them or dismiss the report", async () => {
    const target = await newMember("Spammy Seller");
    const reporter = await newMember("Careful Reader");
    const second = await newMember("Second Reader");
    const builder = await newMember("Plain Builder");
    const org = await organizer();
    const handle = (await ensureProfile(target)).handle;

    await expect(reportProfile(target, handle, { reason: "Reporting myself for fun" })).rejects.toThrow(/your own/);
    await expect(reportProfile(reporter, handle, { reason: "bad" })).rejects.toThrow(/at least 10/);
    const report = await reportProfile(reporter, handle, { reason: "Posts scam links to fake jobs" });
    await expect(reportProfile(reporter, handle, { reason: "Posts scam links to fake jobs" })).rejects.toThrow(/already reported/);
    await reportProfile(second, handle, { reason: "Asking people for MoMo payments" });

    // Builders can't moderate.
    expect(await canModerate(builder)).toBe(false);
    await expect(listReports(builder)).rejects.toThrow(/organizers/);
    await expect(resolveReport(builder, report.id, { action: "HIDE", note: "No" })).rejects.toThrow(/organizers/);

    const open = (await listReports(org)).filter((r) => r.target_handle === handle);
    expect(open.map((r) => r.reporter).sort()).toEqual(["Careful Reader", "Second Reader"]);
    await resolveReport(org, report.id, { action: "HIDE", note: "Scam links" });
    const after = await db.select().from(communityReports).where(eq(communityReports.targetId, target.id));
    expect(after.every((r) => r.status === "RESOLVED" && r.resolvedBy === org.id && r.resolution === "Scam links")).toBe(true);
    expect(await getProfile(handle, builder)).toBeNull();
    await expect(resolveReport(org, report.id, { action: "DISMISS", note: "Again" })).rejects.toThrow(/already handled/);

    await unhideProfile(org, handle);
    expect(await getProfile(handle, builder)).not.toBeNull();

    // Dismissing leaves the profile visible.
    const r2 = await reportProfile(builder, handle, { reason: "I just don't like their bio" });
    await resolveReport(org, r2.id, { action: "DISMISS", note: "No rule broken" });
    expect(await getProfile(handle, builder)).not.toBeNull();
  });

  it("organizers come from COMMUNITY_ORGANIZER_EMAILS or are made by other organizers", async () => {
    const first = await newMember("First Organizer");
    const next = await newMember("Next Organizer");
    const nextHandle = (await ensureProfile(next)).handle;
    expect(await canModerate(first)).toBe(false);
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", `someone@else.test, ${first.email.toUpperCase()}`);
    expect(await canModerate(first)).toBe(true);

    await expect(setOrganizer(next, nextHandle, true)).rejects.toThrow(/organizers/);
    await setOrganizer(first, nextHandle, true);
    expect(await canModerate(next)).toBe(true);
    await expect(setOrganizer(next, nextHandle, false)).rejects.toThrow(/another organizer/);
    await setOrganizer(first, nextHandle, false);
    expect(await canModerate(next)).toBe(false);
  });

  it("keeps community tables away from the app role", async () => {
    const actor = await createUser("ADMIN");
    await expectDbError(withActor(actor, (tx) => tx.select().from(memberProfiles)), /permission denied/);
    await expectDbError(withActor(actor, (tx) => tx.select().from(communityReports)), /permission denied/);
  });
});
