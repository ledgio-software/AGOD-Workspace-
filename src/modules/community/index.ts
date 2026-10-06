import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { communityReports, memberProfiles, users } from "@/lib/db/schema";
import { ServiceError } from "@/modules/errors";

// Phase 25: the community. Everyone who signs up is a member with a profile, whether or not they
// belong to a company. Profiles are public unless the member limits them to signed-in members or
// an organizer hides them. Organizers are members with community_role ORGANIZER, or whose email is
// in COMMUNITY_ORGANIZER_EMAILS (how the first organizers are set).

/** A signed-in person (company membership doesn't matter here). */
export type Member = { id: string; name: string; email: string };
export type Profile = typeof memberProfiles.$inferSelect;

export function organizerEmails(source: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (source.COMMUNITY_ORGANIZER_EMAILS ?? "")
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const isOrganizer = (profile: Pick<Profile, "communityRole"> | null, email: string) =>
  profile?.communityRole === "ORGANIZER" || organizerEmails().has(email.toLowerCase());

/** Chat links shown to members (the handbook's Discord server and WhatsApp group), when set. */
export function chatLinks(source: Record<string, string | undefined> = process.env) {
  const valid = (v: string | undefined) => (v && /^https:\/\/\S+$/.test(v.trim()) ? v.trim() : null);
  return { discord: valid(source.COMMUNITY_DISCORD_URL), whatsapp: valid(source.COMMUNITY_WHATSAPP_URL) };
}

/** "Ama Mensah" → "ama-mensah" (3 to 40 lowercase letters, digits and dashes). */
export function handleFrom(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `member-${base || "x"}`.replace(/-+$/g, "");
}

const HANDLE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

async function handleTaken(handle: string, except?: string) {
  const [row] = await db.select({ userId: memberProfiles.userId }).from(memberProfiles).where(eq(memberProfiles.handle, handle));
  return !!row && row.userId !== except;
}

/**
 * The member's profile, created the first time they use the community. People who joined the
 * community themselves start public; others (e.g. invited to a company) start visible to signed-in
 * members only, until they choose otherwise.
 */
export async function ensureProfile(member: Member, visibility: "PUBLIC" | "MEMBERS" = "MEMBERS"): Promise<Profile> {
  const [existing] = await db.select().from(memberProfiles).where(eq(memberProfiles.userId, member.id));
  if (existing) return existing;
  const base = handleFrom(member.name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const handle = attempt === 0 ? base : `${base.slice(0, 32)}-${Math.random().toString(36).slice(2, 6)}`;
    if (await handleTaken(handle)) continue;
    const [created] = await db.insert(memberProfiles).values({ userId: member.id, handle, visibility }).onConflictDoNothing().returning();
    if (created) return created;
    const [raced] = await db.select().from(memberProfiles).where(eq(memberProfiles.userId, member.id));
    if (raced) return raced;
  }
  throw new ServiceError("Couldn't create your profile. Try again.");
}

/**
 * After someone confirms the email they signed up with: their profile, with the code of conduct
 * they agreed to on the sign-up form.
 */
export async function welcomeNewMember(member: Member) {
  const profile = await ensureProfile(member, "PUBLIC");
  if (!profile.conductAcceptedAt) await db.update(memberProfiles).set({ conductAcceptedAt: new Date() }).where(eq(memberProfiles.userId, member.id));
}

/** What the member still has to do to get started (the handbook's onboarding checklist). */
export function onboarding(profile: Profile) {
  return {
    conduct: profile.conductAcceptedAt !== null,
    profile: !!profile.headline && !!profile.city && profile.tools.length > 0,
  };
}

export async function acceptConduct(member: Member) {
  const profile = await ensureProfile(member);
  if (profile.conductAcceptedAt) return;
  await db.update(memberProfiles).set({ conductAcceptedAt: new Date() }).where(eq(memberProfiles.userId, member.id));
}

/** "github.com/ama" → "https://github.com/ama"; empty → null. Only https links are kept. */
const link = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v === "" ? null : /^https?:\/\//i.test(v) ? v.replace(/^http:\/\//i, "https://") : `https://${v}`))
  .refine((v) => v === null || /^https:\/\/[^\s/]+\.[^\s]+$/.test(v), "Enter a web address such as https://github.com/yourname");

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}: at most ${max} characters`)
    .transform((v) => v || null);

export const profileInput = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(HANDLE, "Profile address: 3 to 40 letters, digits or dashes (not starting or ending with a dash)"),
  headline: optionalText(140, "What you build"),
  bio: optionalText(1500, "About you"),
  city: optionalText(60, "City"),
  tools: z
    .string()
    .max(600)
    .transform((v) => [...new Set(v.split(",").map((t) => t.trim()).filter(Boolean))])
    .refine((list) => list.length <= 15, "At most 15 tools")
    .refine((list) => list.every((t) => t.length <= 30), "Each tool: at most 30 characters"),
  websiteUrl: link,
  githubUrl: link,
  linkedinUrl: link,
  xUrl: link,
  reviewer: z.boolean(),
  wantsMentor: z.boolean(),
  visibility: z.enum(["PUBLIC", "MEMBERS"]),
});

export async function updateProfile(member: Member, raw: z.input<typeof profileInput>): Promise<Profile> {
  const input = profileInput.parse(raw);
  await ensureProfile(member);
  if (await handleTaken(input.handle, member.id)) throw new ServiceError("That profile address is taken. Try another.");
  const [saved] = await db.update(memberProfiles).set(input).where(eq(memberProfiles.userId, member.id)).returning();
  return saved;
}

// --- Reading profiles ----------------------------------------------------------------------------

const card = {
  userId: memberProfiles.userId,
  name: users.name,
  handle: memberProfiles.handle,
  headline: memberProfiles.headline,
  city: memberProfiles.city,
  tools: memberProfiles.tools,
  reviewer: memberProfiles.reviewer,
  wantsMentor: memberProfiles.wantsMentor,
  communityRole: memberProfiles.communityRole,
  createdAt: memberProfiles.createdAt,
};
export type MemberCard = { [K in keyof typeof card]: (typeof card)[K]["_"]["data"] };

/** Profiles anyone (viewer null) or a signed-in member may see: not hidden, active login. */
const visibleTo = (viewer: Member | null) =>
  and(isNull(memberProfiles.hiddenAt), eq(users.active, true), viewer ? undefined : eq(memberProfiles.visibility, "PUBLIC"));

export const PAGE_SIZE = 30;

export async function listMembers(viewer: Member | null, filters: { q?: string; city?: string; reviewers?: boolean; page?: number } = {}) {
  const q = filters.q?.trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const where = and(
    visibleTo(viewer),
    like ? or(ilike(users.name, like), ilike(memberProfiles.headline, like), sql`array_to_string(${memberProfiles.tools}, ' ') ILIKE ${like}`) : undefined,
    filters.city ? ilike(memberProfiles.city, filters.city.trim().slice(0, 60)) : undefined,
    filters.reviewers ? eq(memberProfiles.reviewer, true) : undefined,
  );
  const page = Math.max(1, Math.min(filters.page ?? 1, 1000));
  const rows = await db
    .select(card)
    .from(memberProfiles)
    .innerJoin(users, eq(users.id, memberProfiles.userId))
    .where(where)
    .orderBy(desc(memberProfiles.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  return { members: rows.slice(0, PAGE_SIZE) as MemberCard[], more: rows.length > PAGE_SIZE, page };
}

/** Cities members are in, for the directory filter. */
export async function memberCities(viewer: Member | null): Promise<string[]> {
  const rows = await db
    .selectDistinct({ city: memberProfiles.city })
    .from(memberProfiles)
    .innerJoin(users, eq(users.id, memberProfiles.userId))
    .where(and(visibleTo(viewer), sql`${memberProfiles.city} IS NOT NULL`));
  return rows.map((r) => r.city!).sort((a, b) => a.localeCompare(b));
}

export async function communityStats() {
  const [row] = await db
    .select({
      members: count(),
      reviewers: sql<number>`count(*) FILTER (WHERE ${memberProfiles.reviewer})::int`,
      cities: sql<number>`count(DISTINCT lower(${memberProfiles.city}))::int`,
    })
    .from(memberProfiles)
    .innerJoin(users, eq(users.id, memberProfiles.userId))
    .where(visibleTo(null));
  return row;
}

/**
 * A profile page: null when it doesn't exist or this viewer may not see it. Organizers and the
 * member see hidden profiles (with the reason).
 */
export async function getProfile(handle: string, viewer: Member | null) {
  if (!HANDLE.test(handle)) return null;
  const [row] = await db
    .select({ profile: memberProfiles, name: users.name, active: users.active })
    .from(memberProfiles)
    .innerJoin(users, eq(users.id, memberProfiles.userId))
    .where(eq(memberProfiles.handle, handle));
  if (!row) return null;
  const self = viewer?.id === row.profile.userId;
  const viewerProfile = viewer && !self ? (await db.select().from(memberProfiles).where(eq(memberProfiles.userId, viewer.id)))[0] ?? null : null;
  const organizer = viewer ? isOrganizer(self ? row.profile : viewerProfile, viewer.email) : false;
  if (!self && !organizer) {
    if (row.profile.hiddenAt || !row.active) return null;
    if (row.profile.visibility === "MEMBERS" && !viewer) return null;
  }
  return { ...row, self, organizer };
}

// --- Reports and moderation ------------------------------------------------------------------

export const reportInput = z.object({
  reason: z.string().trim().min(10, "Say what is wrong (at least 10 characters)").max(1000),
});

/** Any member: reports a profile to the organizers. */
export async function reportProfile(member: Member, handle: string, raw: z.input<typeof reportInput>) {
  const input = reportInput.parse(raw);
  const target = await getProfile(handle, member);
  if (!target) throw new ServiceError("Profile not found.");
  if (target.self) throw new ServiceError("You can't report your own profile.");
  const [created] = await db
    .insert(communityReports)
    .values({ reporterId: member.id, targetType: "PROFILE", targetId: target.profile.userId, reason: input.reason })
    .onConflictDoNothing()
    .returning();
  if (!created) throw new ServiceError("You already reported this profile. The organizers will look at it.");
  return created;
}

async function requireOrganizer(member: Member) {
  const [profile] = await db.select().from(memberProfiles).where(eq(memberProfiles.userId, member.id));
  if (!isOrganizer(profile ?? null, member.email)) throw new ServiceError("Only community organizers can do that.");
}

export async function canModerate(member: Member) {
  const [profile] = await db.select().from(memberProfiles).where(eq(memberProfiles.userId, member.id));
  return isOrganizer(profile ?? null, member.email);
}

/** Organizers: reports, open ones first. */
export async function listReports(member: Member) {
  await requireOrganizer(member);
  const rows = await db.execute<{
    id: string;
    reason: string;
    status: string;
    resolution: string | null;
    created_at: Date;
    resolved_at: Date | null;
    reporter: string;
    target_name: string | null;
    target_handle: string | null;
    target_hidden: boolean | null;
    resolver: string | null;
  }>(sql`
    SELECT r.id, r.reason, r.status, r.resolution, r.created_at, r.resolved_at,
           ru.name AS reporter, tu.name AS target_name, p.handle AS target_handle, (p.hidden_at IS NOT NULL) AS target_hidden,
           su.name AS resolver
    FROM community_reports r
    JOIN users ru ON ru.id = r.reporter_id
    LEFT JOIN member_profiles p ON r.target_type = 'PROFILE' AND p.user_id = r.target_id
    LEFT JOIN users tu ON tu.id = p.user_id
    LEFT JOIN users su ON su.id = r.resolved_by
    ORDER BY (r.status = 'OPEN') DESC, r.created_at DESC
    LIMIT 100
  `);
  return rows.rows.map((r) => ({ ...r, created_at: new Date(r.created_at), resolved_at: r.resolved_at ? new Date(r.resolved_at) : null }));
}

export const resolveInput = z.object({
  action: z.enum(["HIDE", "DISMISS"]),
  note: z.string().trim().min(3, "Add a short note (what you did and why)").max(500),
});

/** Organizers: closes a report, hiding the profile ("HIDE") or not ("DISMISS"). */
export async function resolveReport(member: Member, reportId: string, raw: z.input<typeof resolveInput>) {
  await requireOrganizer(member);
  const input = resolveInput.parse(raw);
  await db.transaction(async (tx) => {
    const [report] = await tx.select().from(communityReports).where(eq(communityReports.id, reportId)).for("update");
    if (!report || report.status !== "OPEN") throw new ServiceError("This report was already handled.");
    if (input.action === "HIDE") {
      if (report.targetId === member.id) throw new ServiceError("Ask another organizer to handle a report about you.");
      await tx
        .update(memberProfiles)
        .set({ hiddenAt: new Date(), hiddenBy: member.id, hiddenReason: input.note })
        .where(and(eq(memberProfiles.userId, report.targetId), isNull(memberProfiles.hiddenAt)));
    }
    // Every open report about the same profile is settled together.
    await tx
      .update(communityReports)
      .set({ status: input.action === "HIDE" ? "RESOLVED" : "DISMISSED", resolution: input.note, resolvedBy: member.id, resolvedAt: new Date() })
      .where(and(eq(communityReports.targetType, report.targetType), eq(communityReports.targetId, report.targetId), eq(communityReports.status, "OPEN")));
  });
}

/** Organizers: shows a hidden profile again. */
export async function unhideProfile(member: Member, handle: string) {
  await requireOrganizer(member);
  const [updated] = await db
    .update(memberProfiles)
    .set({ hiddenAt: null, hiddenBy: null, hiddenReason: null })
    .where(eq(memberProfiles.handle, handle))
    .returning({ userId: memberProfiles.userId });
  if (!updated) throw new ServiceError("Profile not found.");
}

/** Organizers: makes another member an organizer, or a builder again. */
export async function setOrganizer(member: Member, handle: string, on: boolean) {
  await requireOrganizer(member);
  const [target] = await db.select().from(memberProfiles).where(eq(memberProfiles.handle, handle));
  if (!target) throw new ServiceError("Profile not found.");
  if (target.userId === member.id && !on) throw new ServiceError("Ask another organizer to change your own role.");
  await db.update(memberProfiles).set({ communityRole: on ? "ORGANIZER" : "BUILDER" }).where(eq(memberProfiles.userId, target.userId));
}
