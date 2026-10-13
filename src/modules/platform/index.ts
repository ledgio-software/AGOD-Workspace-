import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import journal from "../../../db/migrations/meta/_journal.json";
import { db } from "@/lib/db";
import { memberProfiles, organizations, platformAudit, sessions, users } from "@/lib/db/schema";
import { emailConfig } from "@/lib/email";
import { indexingAllowed, siteUrl } from "@/lib/site";
import { isPlatformAdmin, platformAdminEmails } from "@/lib/staff";
import { storage } from "@/lib/storage";
import { createPasswordLink, sendAccountEmail, signupOpen } from "@/modules/accounts";
import { type Member, listReports, organizerEmails, setOrganizer } from "@/modules/community";
import { NEWS_SOURCES } from "@/modules/community/news";
import { resetPasswordMessage } from "@/modules/email/account";
import { ServiceError } from "@/modules/errors";
import { DAILY_JOB } from "@/modules/jobs/daily";

// Phase 40: the AGOD back office (/console), for platform staff (PLATFORM_ADMIN_EMAILS). It sees
// across companies, but only a summary of each (name, people, counts, last activity), never their
// projects, customers, invoices or payouts. Staff can suspend and restore companies, block and
// restore logins, send password-reset links and manage community organizers; every such action
// needs a reason and is written to platform_audit.

export type Staff = Member;

/** The signed-in person, if they are back-office staff with an active, verified login. */
export async function asStaff(member: Member | null): Promise<Staff | null> {
  if (!member || !isPlatformAdmin(member.email)) return null;
  const [u] = await db.select({ active: users.active, verified: users.emailVerified }).from(users).where(eq(users.id, member.id));
  return u?.active && u.verified ? member : null;
}

async function requireStaff(member: Member): Promise<Staff> {
  const staff = await asStaff(member);
  if (!staff) throw new ServiceError("Only AGOD back-office staff can do that.");
  return staff;
}

const reasonInput = z.string().trim().min(5, "Give a reason (at least 5 characters); it goes in the back-office log.").max(500, "Reason: at most 500 characters");
const validId = (id: string) => z.uuid().safeParse(id).success;

async function audit(staff: Staff, entry: { action: string; targetType: "COMPANY" | "USER" | "PROFILE"; targetId: string | null; targetLabel: string; reason?: string | null }) {
  await db.insert(platformAudit).values({ actorId: staff.id, ...entry, reason: entry.reason ?? null });
}

// --- Overview and health ----------------------------------------------------------------------

export type Overview = {
  people: number;
  activeLogins7d: number;
  newPeople7d: number;
  companies: number;
  suspendedCompanies: number;
  blockedLogins: number;
  communityMembers: number;
  articles: number;
  projects: number;
  openJobs: number;
  openReports: number;
  signupsByWeek: { week: string; people: number }[];
};

export async function overview(member: Member): Promise<Overview> {
  await requireStaff(member);
  const [n] = (
    await db.execute<Record<string, number>>(sql`
      SELECT
        (SELECT count(*)::int FROM users) AS people,
        (SELECT count(DISTINCT user_id)::int FROM sessions WHERE updated_at > now() - interval '7 days') AS active_logins_7d,
        (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_people_7d,
        (SELECT count(*)::int FROM organizations) AS companies,
        (SELECT count(*)::int FROM organizations WHERE suspended_at IS NOT NULL) AS suspended_companies,
        (SELECT count(*)::int FROM users WHERE NOT active) AS blocked_logins,
        (SELECT count(*)::int FROM member_profiles) AS community_members,
        (SELECT count(*)::int FROM articles WHERE status = 'PUBLISHED' AND removed_at IS NULL AND hidden_at IS NULL) AS articles,
        (SELECT count(*)::int FROM showcase_posts WHERE removed_at IS NULL AND hidden_at IS NULL) AS projects,
        (SELECT count(*)::int FROM community_jobs WHERE status = 'OPEN' AND hidden_at IS NULL AND closes_on >= current_date) AS open_jobs,
        (SELECT count(*)::int FROM community_reports WHERE status = 'OPEN') AS open_reports`)
  ).rows;
  const weeks = await db.execute<{ week: string; people: number }>(sql`
    SELECT to_char(w, 'DD Mon') AS week, (SELECT count(*)::int FROM users WHERE created_at >= w AND created_at < w + interval '7 days') AS people
    FROM generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') w
    ORDER BY w`);
  return {
    people: n.people,
    activeLogins7d: n.active_logins_7d,
    newPeople7d: n.new_people_7d,
    companies: n.companies,
    suspendedCompanies: n.suspended_companies,
    blockedLogins: n.blocked_logins,
    communityMembers: n.community_members,
    articles: n.articles,
    projects: n.projects,
    openJobs: n.open_jobs,
    openReports: n.open_reports,
    signupsByWeek: weeks.rows,
  };
}

export type HealthCheck = { key: string; label: string; state: "ok" | "warn" | "off"; detail: string };

/** Whether the parts of the platform that run on their own are set up and working. */
export async function health(member: Member, source: Record<string, string | undefined> = process.env): Promise<HealthCheck[]> {
  await requireStaff(member);
  const started = Date.now();
  await db.execute(sql`select 1`);
  const dbMs = Date.now() - started;
  const [migrations] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)).rows;
  const expected = journal.entries.length;
  const [daily] = (
    await db.execute<{ started_at: Date | null; ok: boolean | null; failed: number }>(sql`
      SELECT max(started_at) AS started_at,
             bool_and(ok) FILTER (WHERE started_at > now() - interval '26 hours') AS ok,
             count(*) FILTER (WHERE started_at > now() - interval '26 hours' AND ok IS FALSE)::int AS failed
      FROM job_runs WHERE job = ${DAILY_JOB}`)
  ).rows;
  const news = (await db.execute<{ key: string; enabled: boolean; last_ok_at: Date | null; last_error: string | null }>(sql`SELECT key, enabled, last_ok_at, last_error FROM news_sources`)).rows;
  const newsOn = news.filter((s) => s.enabled && NEWS_SOURCES.some((n) => n.key === s.key));
  const newsFailing = newsOn.filter((s) => s.last_error);
  const lastDaily = daily?.started_at ? new Date(daily.started_at) : null;
  const dailyFresh = lastDaily && Date.now() - lastDaily.getTime() < 26 * 3_600_000;
  const cron = source.CRON_SECRET && source.CRON_SECRET.length >= 16;
  const base = siteUrl(source);

  return [
    { key: "database", label: "Database", state: dbMs < 500 ? "ok" : "warn", detail: `Answered in ${dbMs} ms.` },
    {
      key: "migrations",
      label: "Database migrations",
      state: migrations.n >= expected ? "ok" : "warn",
      detail: migrations.n >= expected ? `All ${expected} applied.` : `${migrations.n} of ${expected} applied: run the migrations (docs/RELEASES.md).`,
    },
    {
      key: "daily",
      label: "Daily job",
      state: !cron ? "off" : dailyFresh && daily.failed === 0 ? "ok" : "warn",
      detail: !cron
        ? "CRON_SECRET isn't set, so the daily job can't run (reminders, emails, news, project of the month)."
        : lastDaily
          ? `Last ran ${lastDaily.toISOString().replace("T", " ").slice(0, 16)} UTC${daily.failed ? `; ${daily.failed} company run(s) failed in the last day` : ""}${dailyFresh ? "" : "; more than a day ago"}.`
          : "Hasn't run yet.",
    },
    { key: "email", label: "Email", state: emailConfig(source) ? "ok" : "off", detail: emailConfig(source) ? "Set up: sign-up, invitations, reminders and notices are sent." : "Not set up: no emails are sent (SMTP_* settings)." },
    { key: "signup", label: "Sign-up", state: signupOpen(source) ? "ok" : "off", detail: signupOpen(source) ? "Open to new people." : "Closed (ALLOW_SIGNUP and email are both needed)." },
    { key: "storage", label: "File storage", state: storage(source) ? "ok" : "off", detail: storage(source) ? "On: uploads, screenshots and pictures work." : "Off: uploads and pictures are switched off (docs/STORAGE.md)." },
    {
      key: "news",
      label: "Tech news sources",
      state: newsOn.length === 0 ? "off" : newsFailing.length === 0 ? "ok" : "warn",
      detail: newsOn.length === 0 ? "Not fetched yet, or all switched off." : newsFailing.length === 0 ? `${newsOn.length} sources working.` : `${newsFailing.length} of ${newsOn.length} failing: ${newsFailing.map((s) => s.key).join(", ")}.`,
    },
    {
      key: "address",
      label: "Site address",
      state: base ? "ok" : "warn",
      detail: base ? `${base}${indexingAllowed(source) ? " (indexed by search engines)" : " (not indexed: preview, staging or switched off)"}.` : "Unknown: set BETTER_AUTH_URL so links in emails work.",
    },
    { key: "monitoring", label: "Error monitoring", state: source.SENTRY_DSN ? "ok" : "off", detail: source.SENTRY_DSN ? "Sentry is on." : "Sentry isn't set up (SENTRY_DSN)." },
    { key: "staff", label: "Back-office staff", state: "ok", detail: `${platformAdminEmails(source).size} in PLATFORM_ADMIN_EMAILS.` },
  ];
}

// --- Companies -------------------------------------------------------------------------------

export type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  teamType: string;
  createdAt: Date;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  members: number;
  admins: number;
  projects: number;
  lastActivity: Date | null;
};

const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

async function companyRows(where: ReturnType<typeof sql>, limit: number): Promise<CompanyRow[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    slug: string;
    team_type: string;
    created_at: Date;
    suspended_at: Date | null;
    suspended_reason: string | null;
    members: number;
    admins: number;
    projects: number;
    last_activity: Date | null;
  }>(sql`
    SELECT o.id, o.name, o.slug, o.team_type, o.created_at, o.suspended_at, o.suspended_reason,
      (SELECT count(*)::int FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = o.id AND m.active AND u.active) AS members,
      (SELECT count(*)::int FROM memberships m WHERE m.organization_id = o.id AND m.active AND m.role = 'ADMIN') AS admins,
      (SELECT count(*)::int FROM projects p WHERE p.organization_id = o.id) AS projects,
      (SELECT max(a.created_at) FROM audit_events a WHERE a.organization_id = o.id) AS last_activity
    FROM organizations o
    WHERE ${where}
    ORDER BY o.created_at DESC
    LIMIT ${limit}`);
  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    teamType: r.team_type,
    createdAt: new Date(r.created_at),
    suspendedAt: r.suspended_at ? new Date(r.suspended_at) : null,
    suspendedReason: r.suspended_reason,
    members: r.members,
    admins: r.admins,
    projects: r.projects,
    lastActivity: r.last_activity ? new Date(r.last_activity) : null,
  }));
}

export async function listCompanies(member: Member, filters: { q?: string; status?: string } = {}): Promise<CompanyRow[]> {
  await requireStaff(member);
  const q = filters.q?.trim().slice(0, 60);
  const where = sql.join(
    [
      sql`true`,
      q ? sql`(o.name ILIKE ${like(q)} OR o.slug ILIKE ${like(q)})` : sql`true`,
      filters.status === "suspended" ? sql`o.suspended_at IS NOT NULL` : filters.status === "active" ? sql`o.suspended_at IS NULL` : sql`true`,
    ],
    sql` AND `,
  );
  return companyRows(where, 200);
}

export type CompanyMember = { userId: string; name: string; email: string; role: string; active: boolean; loginActive: boolean; joinedAt: Date };
export type AuditRow = { id: string; action: string; targetType: string; targetId: string | null; targetLabel: string; reason: string | null; actor: string; createdAt: Date };

export async function getCompany(member: Member, orgId: string): Promise<{ company: CompanyRow; members: CompanyMember[]; log: AuditRow[] } | null> {
  await requireStaff(member);
  if (!validId(orgId)) return null;
  const [company] = await companyRows(sql`o.id = ${orgId}`, 1);
  if (!company) return null;
  const members = await db.execute<{ user_id: string; name: string; email: string; role: string; active: boolean; login_active: boolean; joined_at: Date }>(sql`
    SELECT m.user_id, u.name, u.email, m.role, m.active, u.active AS login_active, m.created_at AS joined_at
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ${orgId}
    ORDER BY m.active DESC, (m.role = 'ADMIN') DESC, u.name`);
  return {
    company,
    members: members.rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role, active: r.active, loginActive: r.login_active, joinedAt: new Date(r.joined_at) })),
    log: await auditFor("COMPANY", orgId),
  };
}

/** Closes a company to its members (they keep the community), or opens it again. Nothing is deleted. */
export async function setCompanySuspended(member: Member, orgId: string, suspended: boolean, rawReason: string) {
  const staff = await requireStaff(member);
  const reason = reasonInput.parse(rawReason);
  if (!validId(orgId)) throw new ServiceError("Company not found.");
  const [org] = await db.select({ name: organizations.name, suspendedAt: organizations.suspendedAt }).from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw new ServiceError("Company not found.");
  if (suspended === (org.suspendedAt !== null)) throw new ServiceError(suspended ? "This company is already suspended." : "This company isn't suspended.");
  await db
    .update(organizations)
    .set(suspended ? { suspendedAt: new Date(), suspendedReason: reason } : { suspendedAt: null, suspendedReason: null })
    .where(eq(organizations.id, orgId));
  await audit(staff, { action: suspended ? "COMPANY_SUSPENDED" : "COMPANY_RESTORED", targetType: "COMPANY", targetId: orgId, targetLabel: org.name, reason });
}

// --- People ----------------------------------------------------------------------------------

export type PersonRow = {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  active: boolean;
  createdAt: Date;
  lastSeen: Date | null;
  companies: number;
  handle: string | null;
  staff: boolean;
};

export const PEOPLE_PAGE = 50;

export async function listPeople(member: Member, filters: { q?: string; status?: string; page?: number } = {}): Promise<{ people: PersonRow[]; more: boolean; page: number }> {
  await requireStaff(member);
  const q = filters.q?.trim().slice(0, 80);
  const page = Math.max(1, Math.min(filters.page ?? 1, 1000));
  const rows = await db.execute<{ id: string; name: string; email: string; email_verified: boolean; active: boolean; created_at: Date; last_seen: Date | null; companies: number; handle: string | null }>(sql`
    SELECT u.id, u.name, u.email, u.email_verified, u.active, u.created_at,
      (SELECT max(s.updated_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
      (SELECT count(*)::int FROM memberships m WHERE m.user_id = u.id AND m.active) AS companies,
      p.handle
    FROM users u LEFT JOIN member_profiles p ON p.user_id = u.id
    WHERE ${q ? sql`(u.name ILIKE ${like(q)} OR u.email ILIKE ${like(q)} OR p.handle ILIKE ${like(q)})` : sql`true`}
      AND ${filters.status === "blocked" ? sql`NOT u.active` : filters.status === "unverified" ? sql`NOT u.email_verified` : sql`true`}
    ORDER BY u.created_at DESC
    LIMIT ${PEOPLE_PAGE + 1} OFFSET ${(page - 1) * PEOPLE_PAGE}`);
  const people = rows.rows.slice(0, PEOPLE_PAGE).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    verified: r.email_verified,
    active: r.active,
    createdAt: new Date(r.created_at),
    lastSeen: r.last_seen ? new Date(r.last_seen) : null,
    companies: r.companies,
    handle: r.handle,
    staff: isPlatformAdmin(r.email),
  }));
  return { people, more: rows.rows.length > PEOPLE_PAGE, page };
}

export type PersonDetail = PersonRow & {
  companyList: { id: string; name: string; role: string; active: boolean; suspended: boolean }[];
  profile: { handle: string; visibility: string; communityRole: string; hidden: boolean } | null;
  openSessions: number;
  log: AuditRow[];
};

export async function getPerson(member: Member, userId: string): Promise<PersonDetail | null> {
  await requireStaff(member);
  if (!validId(userId)) return null;
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) return null;
  const companyList = await db.execute<{ id: string; name: string; role: string; active: boolean; suspended: boolean }>(sql`
    SELECT o.id, o.name, m.role, m.active, o.suspended_at IS NOT NULL AS suspended
    FROM memberships m JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = ${userId} ORDER BY o.name`);
  const [profile] = await db.select().from(memberProfiles).where(eq(memberProfiles.userId, userId));
  const [s] = (await db.execute<{ n: number; last: Date | null }>(sql`SELECT count(*) FILTER (WHERE expires_at > now())::int AS n, max(updated_at) AS last FROM sessions WHERE user_id = ${userId}`)).rows;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    verified: u.emailVerified,
    active: u.active,
    createdAt: u.createdAt,
    lastSeen: s.last ? new Date(s.last) : null,
    companies: companyList.rows.filter((c) => c.active).length,
    handle: profile?.handle ?? null,
    staff: isPlatformAdmin(u.email),
    companyList: companyList.rows,
    profile: profile ? { handle: profile.handle, visibility: profile.visibility, communityRole: profile.communityRole, hidden: profile.hiddenAt !== null } : null,
    openSessions: s.n,
    log: await auditFor("USER", userId),
  };
}

/** Blocks a login (signs them out everywhere; they can't sign in) or restores it. */
export async function setLoginBlocked(member: Member, userId: string, blocked: boolean, rawReason: string) {
  const staff = await requireStaff(member);
  const reason = reasonInput.parse(rawReason);
  if (!validId(userId)) throw new ServiceError("Person not found.");
  const [u] = await db.select({ name: users.name, email: users.email, active: users.active }).from(users).where(eq(users.id, userId));
  if (!u) throw new ServiceError("Person not found.");
  if (blocked && userId === staff.id) throw new ServiceError("You can't block your own login.");
  if (blocked && isPlatformAdmin(u.email)) throw new ServiceError("Back-office staff can't be blocked here: remove them from PLATFORM_ADMIN_EMAILS first.");
  if (blocked === !u.active) throw new ServiceError(blocked ? "This login is already blocked." : "This login isn't blocked.");
  await db.transaction(async (tx) => {
    await tx.update(users).set({ active: !blocked }).where(eq(users.id, userId));
    if (blocked) await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
  await audit(staff, { action: blocked ? "LOGIN_BLOCKED" : "LOGIN_RESTORED", targetType: "USER", targetId: userId, targetLabel: `${u.name} <${u.email}>`, reason });
}

/** Emails the person a link to choose a new password (valid for a day). */
export async function sendResetLink(member: Member, userId: string): Promise<void> {
  const staff = await requireStaff(member);
  if (!validId(userId)) throw new ServiceError("Person not found.");
  const [u] = await db.select({ name: users.name, email: users.email, active: users.active }).from(users).where(eq(users.id, userId));
  if (!u) throw new ServiceError("Person not found.");
  if (!u.active) throw new ServiceError("This login is blocked. Restore it first.");
  if (!emailConfig()) throw new ServiceError("Email isn't set up on this site, so no link can be sent.");
  const url = await createPasswordLink(userId, 1);
  await sendAccountEmail(u.email, resetPasswordMessage({ name: u.name, url }));
  await audit(staff, { action: "RESET_LINK_SENT", targetType: "USER", targetId: userId, targetLabel: `${u.name} <${u.email}>` });
}

// --- Community moderation --------------------------------------------------------------------

export async function openReports(member: Member) {
  await requireStaff(member);
  return (await listReports(member)).filter((r) => r.status === "OPEN");
}

export type HiddenItem = { kind: string; id: string; label: string; link: string; hiddenAt: Date; reason: string | null; hiddenBy: string | null };

/** Everything organizers have hidden, newest first, with a link to where it can be shown again. */
export async function hiddenItems(member: Member): Promise<HiddenItem[]> {
  await requireStaff(member);
  const rows = await db.execute<{ kind: string; id: string; label: string; link: string; hidden_at: Date; reason: string | null; hidden_by: string | null }>(sql`
    SELECT h.*, hu.name AS hidden_by FROM (
      SELECT 'Profile' AS kind, p.user_id::text AS id, u.name AS label, '/members/' || p.handle AS link, p.hidden_at, p.hidden_reason AS reason, p.hidden_by AS by FROM member_profiles p JOIN users u ON u.id = p.user_id WHERE p.hidden_at IS NOT NULL
      UNION ALL SELECT 'Project', s.id::text, s.title, '/showcase/' || s.id, s.hidden_at, s.hidden_reason, s.hidden_by FROM showcase_posts s WHERE s.hidden_at IS NOT NULL AND s.removed_at IS NULL
      UNION ALL SELECT 'Feedback', r.id::text, 'Feedback on ' || s.title, '/showcase/' || s.id || '#reviews', r.hidden_at, r.hidden_reason, r.hidden_by FROM showcase_reviews r JOIN showcase_posts s ON s.id = r.post_id WHERE r.hidden_at IS NOT NULL
      UNION ALL SELECT 'Session', c.id::text, c.title, '/sessions/' || c.id, c.hidden_at, c.hidden_reason, c.hidden_by FROM community_sessions c WHERE c.hidden_at IS NOT NULL
      UNION ALL SELECT 'Tool or prompt', l.id::text, l.title, '/library/' || l.id, l.hidden_at, l.hidden_reason, l.hidden_by FROM library_items l WHERE l.hidden_at IS NOT NULL AND l.removed_at IS NULL
      UNION ALL SELECT 'Job', j.id::text, j.title, '/jobs/' || j.id, j.hidden_at, j.hidden_reason, j.hidden_by FROM community_jobs j WHERE j.hidden_at IS NOT NULL
      UNION ALL SELECT 'Team post', t.id::text, t.title, '/teams/' || t.id, t.hidden_at, t.hidden_reason, t.hidden_by FROM team_posts t WHERE t.hidden_at IS NOT NULL
      UNION ALL SELECT 'Chat message', m.id::text, left(m.body, 80), '/community/chat/' || ch.slug || '?thread=' || coalesce(m.parent_id, m.id), m.hidden_at, m.hidden_reason, m.hidden_by FROM chat_messages m JOIN chat_channels ch ON ch.id = m.channel_id WHERE m.hidden_at IS NOT NULL AND m.removed_at IS NULL
      UNION ALL SELECT 'Article', a.id::text, a.title, '/articles/' || a.id, a.hidden_at, a.hidden_reason, a.hidden_by FROM articles a WHERE a.hidden_at IS NOT NULL AND a.removed_at IS NULL
      UNION ALL SELECT 'Article comment', c.id::text, 'Comment on ' || a.title, '/articles/' || a.id || '#comments', c.hidden_at, c.hidden_reason, c.hidden_by FROM article_comments c JOIN articles a ON a.id = c.article_id WHERE c.hidden_at IS NOT NULL AND c.removed_at IS NULL
      UNION ALL SELECT 'News headline', n.id::text, n.title, '/news', n.hidden_at, NULL, n.hidden_by FROM news_items n WHERE n.hidden_at IS NOT NULL
    ) h LEFT JOIN users hu ON hu.id = h.by
    ORDER BY h.hidden_at DESC
    LIMIT 200`);
  return rows.rows.map((r) => ({ kind: r.kind, id: r.id, label: r.label, link: r.link, hiddenAt: new Date(r.hidden_at), reason: r.reason, hiddenBy: r.hidden_by }));
}

export type OrganizerRow = { name: string; email: string; handle: string | null; via: "role" | "setting" | "staff" };

/** Everyone who can moderate: organizers by role, by the COMMUNITY_ORGANIZER_EMAILS setting, and staff. */
export async function listOrganizers(member: Member): Promise<OrganizerRow[]> {
  await requireStaff(member);
  const byRole = await db
    .select({ name: users.name, email: users.email, handle: memberProfiles.handle })
    .from(memberProfiles)
    .innerJoin(users, eq(users.id, memberProfiles.userId))
    .where(eq(memberProfiles.communityRole, "ORGANIZER"));
  const fromSettings = [...organizerEmails(), ...platformAdminEmails()];
  const settingUsers = fromSettings.length
    ? await db
        .select({ name: users.name, email: users.email, handle: memberProfiles.handle })
        .from(users)
        .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
        .where(sql`lower(${users.email}) IN (${sql.join(fromSettings.map((e) => sql`${e}`), sql`, `)})`)
    : [];
  const out = new Map<string, OrganizerRow>();
  for (const u of settingUsers) out.set(u.email.toLowerCase(), { ...u, via: isPlatformAdmin(u.email) ? "staff" : "setting" });
  for (const u of byRole) if (!out.has(u.email.toLowerCase())) out.set(u.email.toLowerCase(), { ...u, via: "role" });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Makes a member an organizer by their profile address, or a builder again. */
export async function setOrganizerRole(member: Member, rawHandle: string, on: boolean) {
  const staff = await requireStaff(member);
  const handle = rawHandle.trim().replace(/^.*\/members\//, "").replace(/^@/, "").toLowerCase();
  await setOrganizer(staff, handle, on);
  const [p] = await db.select({ userId: memberProfiles.userId, name: users.name }).from(memberProfiles).innerJoin(users, eq(users.id, memberProfiles.userId)).where(eq(memberProfiles.handle, handle));
  await audit(staff, { action: on ? "ORGANIZER_ADDED" : "ORGANIZER_REMOVED", targetType: "PROFILE", targetId: p.userId, targetLabel: `${p.name} (@${handle})` });
}

// --- Back-office log -------------------------------------------------------------------------

async function auditFor(targetType: "COMPANY" | "USER", targetId: string): Promise<AuditRow[]> {
  return auditRows(and(eq(platformAudit.targetType, targetType), eq(platformAudit.targetId, targetId)), 50);
}

async function auditRows(where: ReturnType<typeof and>, limit: number): Promise<AuditRow[]> {
  return db
    .select({
      id: platformAudit.id,
      action: platformAudit.action,
      targetType: platformAudit.targetType,
      targetId: platformAudit.targetId,
      targetLabel: platformAudit.targetLabel,
      reason: platformAudit.reason,
      actor: users.name,
      createdAt: platformAudit.createdAt,
    })
    .from(platformAudit)
    .innerJoin(users, eq(users.id, platformAudit.actorId))
    .where(where)
    .orderBy(desc(platformAudit.createdAt))
    .limit(limit);
}

export async function platformLog(member: Member): Promise<AuditRow[]> {
  await requireStaff(member);
  return auditRows(undefined, 300);
}
