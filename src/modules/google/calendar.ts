import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import {
  calendarEvents,
  customers,
  googleConnections,
  invoices,
  memberships,
  milestones,
  organizations,
  projectMeetings,
  projects,
  services,
  subscriptions,
  tasks,
  users,
} from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import {
  type CalendarEventInput,
  calendarUrl,
  createCalendar,
  deleteEvent,
  exchangeCode,
  getCalendar,
  insertEvent,
  inviteToEvent,
  listCalendarAcl,
  revokeToken,
  shareCalendar,
  unshareCalendar,
  updateEvent,
  userEmail,
} from "@/lib/google/client";
import { COMPANY_CALENDAR_SCOPE, PERSONAL_CALENDAR_SCOPE, googleConfig } from "@/lib/google/config";
import { openSecret, sealSecret } from "@/lib/google/secret";
import { formatMoney } from "@/lib/money";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import {
  type Connection,
  type GoogleSession,
  LIVE_STATUSES,
  accessTokenFor,
  call,
  companyConnection,
  describeError,
  googleRedirectUri,
  isSignInError,
} from "./index";

// Phase 24: Google Calendar.
//  - The company calendar (in the company Google account, shared read-only with PMs and Admins):
//    project target dates, milestones, task due dates, subscription renewals and invoice due dates.
//    Not shared with Team Members, who don't see other people's projects; they get their own.
//  - Personal calendars: anyone can connect their own Google account; the app keeps a calendar there
//    with their own task due dates (the calendar.app.created permission: it can't see the rest).
//  - Project meetings: managers schedule them on a project; Google adds a Meet link and emails the
//    invitation to the project's team.
// Events are kept in step by a sync (daily, after changes from "Sync now", on connecting) that adds,
// updates and removes only the events the app made.

const TIME_ZONE = process.env.APP_TIMEZONE ?? "Africa/Accra";
type Source = "PROJECT_TARGET" | "MILESTONE" | "TASK_DUE" | "RENEWAL" | "INVOICE_DUE";
type Item = { source: Source; entityId: string; event: CalendarEventInput };
export type CalendarSyncSummary = { created: number; updated: number; removed: number; failures: string[] };

const appLink = (path: string) => `${(process.env.BETTER_AUTH_URL || "").replace(/\/$/, "")}${path}`;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const hasScope = (connection: Connection, scope: string) => connection.scopes.split(" ").includes(scope);

async function session(connection: Connection): Promise<GoogleSession | null> {
  const config = googleConfig();
  if (!config) return null;
  return { config, connection, token: await accessTokenFor(config, connection) };
}

// --- What goes in a calendar -------------------------------------------------------------------

/** From a month ago to a year ahead: enough to plan with, bounded in size. */
function window() {
  const today = todayInOperatingZone();
  return { from: addDays(today, -31), to: addDays(today, 366) };
}

async function companyItems(orgId: string): Promise<Item[]> {
  const { from, to } = window();
  const live = and(eq(projects.organizationId, orgId), inArray(projects.status, [...LIVE_STATUSES]));
  const items: Item[] = [];

  const targets = await db
    .select({ id: projects.id, code: projects.code, name: projects.name, date: projects.targetDate })
    .from(projects)
    .where(and(live, isNotNull(projects.targetDate), gte(projects.targetDate, from), lte(projects.targetDate, to)));
  for (const p of targets) {
    items.push({ source: "PROJECT_TARGET", entityId: p.id, event: { summary: `🎯 ${p.code} ${p.name}: target date`, date: p.date!, description: appLink(`/projects/${p.id}`) } });
  }

  const ms = await db
    .select({ id: milestones.id, title: milestones.title, date: milestones.dueDate, projectId: projects.id, code: projects.code })
    .from(milestones)
    .innerJoin(projects, eq(projects.id, milestones.projectId))
    .where(and(live, ne(milestones.status, "COMPLETED"), isNotNull(milestones.dueDate), gte(milestones.dueDate, from), lte(milestones.dueDate, to)));
  for (const m of ms) {
    items.push({ source: "MILESTONE", entityId: m.id, event: { summary: `◆ ${m.code}: ${m.title}`, date: m.date!, description: appLink(`/projects/${m.projectId}`) } });
  }

  for (const t of await openTasks(orgId)) items.push(t);

  const renewals = await db
    .select({ id: subscriptions.id, date: subscriptions.renewalDate, service: services.name, customer: customers.name })
    .from(subscriptions)
    .innerJoin(services, eq(services.id, subscriptions.serviceId))
    .innerJoin(customers, eq(customers.id, subscriptions.customerId))
    .where(
      and(
        eq(subscriptions.organizationId, orgId),
        inArray(subscriptions.status, ["ACTIVE", "PAUSED"]),
        isNotNull(subscriptions.renewalDate),
        gte(subscriptions.renewalDate, from),
        lte(subscriptions.renewalDate, to),
      ),
    );
  for (const r of renewals) {
    items.push({ source: "RENEWAL", entityId: r.id, event: { summary: `↻ Renewal: ${r.service} for ${r.customer}`, date: r.date!, description: appLink(`/subscriptions/${r.id}`) } });
  }

  const due = await db
    .select({ id: invoices.id, number: invoices.number, date: invoices.dueDate, total: invoices.totalMinor, paid: invoices.paidMinor, currency: invoices.currency, customer: customers.name })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(
      and(
        eq(invoices.organizationId, orgId),
        eq(invoices.status, "ISSUED"),
        sql`${invoices.paidMinor} < ${invoices.totalMinor}`,
        isNotNull(invoices.dueDate),
        gte(invoices.dueDate, from),
        lte(invoices.dueDate, to),
      ),
    );
  for (const i of due) {
    items.push({
      source: "INVOICE_DUE",
      entityId: i.id,
      event: { summary: `₵ Invoice ${i.number} due: ${i.customer} (${formatMoney(i.total - i.paid, i.currency)})`, date: i.date!, description: appLink(`/invoices/${i.id}`) },
    });
  }
  return items;
}

/** Open tasks with a due date in live projects (one person's, for their personal calendar). */
async function openTasks(orgId: string, assignee?: string): Promise<Item[]> {
  const { from, to } = window();
  const rows = await db
    .select({ id: tasks.id, number: tasks.number, title: tasks.title, date: tasks.dueDate, projectId: projects.id, code: projects.code, who: users.name })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(
      and(
        eq(projects.organizationId, orgId),
        inArray(projects.status, [...LIVE_STATUSES]),
        notInArray(tasks.status, ["DONE", "WAIVED"]),
        isNotNull(tasks.dueDate),
        gte(tasks.dueDate, from),
        lte(tasks.dueDate, to),
        assignee ? eq(tasks.assignedTo, assignee) : undefined,
      ),
    );
  return rows.map((t) => ({
    source: "TASK_DUE" as const,
    entityId: t.id,
    event: {
      summary: `☐ ${t.code}-T${t.number} ${t.title}${!assignee && t.who ? ` (${t.who})` : ""}`,
      date: t.date!,
      description: appLink(`/projects/${t.projectId}?tab=tasks`),
    },
  }));
}

// --- Keeping a calendar in step ----------------------------------------------------------------

const fingerprint = (e: CalendarEventInput) => createHash("sha256").update(JSON.stringify([e.summary, e.date, e.description])).digest("base64url");

/** The connection's calendar, created (or re-created, if deleted in Google) when needed. */
async function ensureCalendar(s: GoogleSession, name: string): Promise<string> {
  if (s.connection.calendarId) {
    const existing = await call(s, (t) => getCalendar(s.config, t, s.connection.calendarId!));
    if (existing) return existing.id;
  }
  const created = await call(s, (t) => createCalendar(s.config, t, name, TIME_ZONE));
  // A new calendar starts empty and unshared.
  await db.delete(calendarEvents).where(eq(calendarEvents.connectionId, s.connection.id));
  await db.update(googleConnections).set({ calendarId: created.id, calendarSharedWith: [] }).where(eq(googleConnections.id, s.connection.id));
  s.connection = { ...s.connection, calendarId: created.id, calendarSharedWith: [] };
  return created.id;
}

/** Adds, updates and removes the app's events so the calendar shows exactly `items`. */
async function syncEvents(s: GoogleSession, calendarId: string, items: Item[], summary: CalendarSyncSummary) {
  const existing = await db.select().from(calendarEvents).where(eq(calendarEvents.connectionId, s.connection.id));
  const byKey = new Map(existing.map((r) => [`${r.source}:${r.entityId}`, r]));
  const wanted = new Set<string>();
  for (const item of items) {
    const key = `${item.source}:${item.entityId}`;
    wanted.add(key);
    const fp = fingerprint(item.event);
    const row = byKey.get(key);
    try {
      if (row && row.fingerprint === fp) continue;
      if (row) {
        const updated = await call(s, (t) => updateEvent(s.config, t, calendarId, row.googleEventId, item.event));
        if (updated) {
          await db.update(calendarEvents).set({ fingerprint: fp }).where(eq(calendarEvents.id, row.id));
          summary.updated += 1;
          continue;
        }
        // Deleted in Google: add it again.
        await db.delete(calendarEvents).where(eq(calendarEvents.id, row.id));
      }
      const created = await call(s, (t) => insertEvent(s.config, t, calendarId, item.event));
      await db
        .insert(calendarEvents)
        .values({ organizationId: s.connection.organizationId, connectionId: s.connection.id, source: item.source, entityId: item.entityId, googleEventId: created.id, fingerprint: fp })
        .onConflictDoNothing();
      summary.created += 1;
    } catch (error) {
      if (isSignInError(error)) throw error;
      summary.failures.push(`${item.event.summary} — ${describeError(error)}`);
    }
  }
  for (const row of existing) {
    if (wanted.has(`${row.source}:${row.entityId}`)) continue;
    try {
      await call(s, (t) => deleteEvent(s.config, t, calendarId, row.googleEventId));
      await db.delete(calendarEvents).where(eq(calendarEvents.id, row.id));
      summary.removed += 1;
    } catch (error) {
      if (isSignInError(error)) throw error;
      summary.failures.push(`Removing an old event — ${describeError(error)}`);
    }
  }
}

/** The company calendar is shared (read-only) with active PMs and Admins; the app only removes access it gave. */
async function syncCalendarSharing(s: GoogleSession, calendarId: string, orgId: string, summary: CalendarSyncSummary) {
  const managers = await db
    .select({ email: users.email, personal: googleConnections.googleEmail })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(
      googleConnections,
      and(eq(googleConnections.organizationId, orgId), eq(googleConnections.userId, users.id), eq(googleConnections.kind, "PERSONAL"), isNull(googleConnections.disconnectedAt)),
    )
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.active, true), eq(users.active, true), ne(memberships.role, "TEAM_MEMBER")));
  const own = s.connection.googleEmail.toLowerCase();
  const desired = [...new Set(managers.map((m) => (m.personal ?? m.email).toLowerCase()).filter((e) => e !== own))].sort();
  const before = ((s.connection.calendarSharedWith as string[]) ?? []).slice().sort();
  if (desired.join() === before.join()) return;
  const rules = await call(s, (t) => listCalendarAcl(s.config, t, calendarId));
  const has = new Map(rules.filter((r) => r.scope.type === "user" && r.scope.value).map((r) => [r.scope.value!.toLowerCase(), r]));
  const after = new Set(before.filter((e) => has.has(e)));
  for (const email of desired) {
    if (has.has(email)) {
      after.add(email);
      continue;
    }
    try {
      await call(s, (t) => shareCalendar(s.config, t, calendarId, email, "reader"));
      after.add(email);
    } catch (error) {
      if (isSignInError(error)) throw error;
      summary.failures.push(`Sharing the calendar with ${email} — ${describeError(error)}`);
    }
  }
  for (const email of before) {
    if (desired.includes(email)) continue;
    const rule = has.get(email);
    try {
      if (rule && rule.role !== "owner") await call(s, (t) => unshareCalendar(s.config, t, calendarId, rule.id));
      after.delete(email);
    } catch (error) {
      if (isSignInError(error)) throw error;
      summary.failures.push(`Removing ${email} from the calendar — ${describeError(error)}`);
    }
  }
  await db.update(googleConnections).set({ calendarSharedWith: [...after].sort() }).where(eq(googleConnections.id, s.connection.id));
}

async function orgName(orgId: string) {
  return (await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)))[0]?.name ?? "Company";
}

/** The company calendar (when the company account allowed Calendar). Null when there is none to sync. */
export async function syncCompanyCalendar(orgId: string): Promise<CalendarSyncSummary | null> {
  const connection = await companyConnection(orgId);
  if (!connection || !hasScope(connection, COMPANY_CALENDAR_SCOPE)) return null;
  const s = await session(connection);
  if (!s) return null;
  const summary: CalendarSyncSummary = { created: 0, updated: 0, removed: 0, failures: [] };
  const calendarId = await ensureCalendar(s, `${await orgName(orgId)}: projects and deadlines`);
  await syncCalendarSharing(s, calendarId, orgId, summary);
  await syncEvents(s, calendarId, await companyItems(orgId), summary);
  return summary;
}

async function personalConnection(orgId: string, userId: string) {
  const [row] = await db
    .select()
    .from(googleConnections)
    .where(and(eq(googleConnections.organizationId, orgId), eq(googleConnections.userId, userId), eq(googleConnections.kind, "PERSONAL"), isNull(googleConnections.disconnectedAt)));
  return row ?? null;
}

/** One person's calendar: their own open tasks with due dates. */
export async function syncPersonalCalendar(orgId: string, userId: string): Promise<CalendarSyncSummary | null> {
  const connection = await personalConnection(orgId, userId);
  if (!connection) return null;
  const s = await session(connection);
  if (!s) return null;
  const summary: CalendarSyncSummary = { created: 0, updated: 0, removed: 0, failures: [] };
  const calendarId = await ensureCalendar(s, `${await orgName(orgId)}: my tasks`);
  await syncEvents(s, calendarId, await openTasks(orgId, userId), summary);
  await db.update(googleConnections).set({ lastSyncAt: new Date(), lastError: null, lastErrorAt: null }).where(eq(googleConnections.id, connection.id));
  return summary;
}

/**
 * Daily job: the company calendar and everyone's personal calendars. Problems are counted, not thrown.
 * Null when the company has no calendar to keep (Google not set up or nothing connected).
 */
export async function syncCalendars(orgId: string): Promise<CalendarSyncSummary | null> {
  if (!googleConfig()) return null;
  const total: CalendarSyncSummary = { created: 0, updated: 0, removed: 0, failures: [] };
  let any = false;
  const add = (s: CalendarSyncSummary | null) => {
    if (!s) return;
    any = true;
    total.created += s.created;
    total.updated += s.updated;
    total.removed += s.removed;
    total.failures.push(...s.failures);
  };
  try {
    add(await syncCompanyCalendar(orgId));
  } catch (error) {
    any = true;
    total.failures.push(`Company calendar — ${describeError(error)}`);
  }
  const people = await db
    .select({ userId: googleConnections.userId })
    .from(googleConnections)
    .where(and(eq(googleConnections.organizationId, orgId), eq(googleConnections.kind, "PERSONAL"), isNull(googleConnections.disconnectedAt)));
  for (const p of people) {
    try {
      add(await syncPersonalCalendar(orgId, p.userId));
    } catch (error) {
      any = true;
      total.failures.push(`A personal calendar — ${describeError(error)}`);
    }
  }
  const connection = await companyConnection(orgId);
  if (connection && hasScope(connection, COMPANY_CALENDAR_SCOPE)) {
    const last = (connection.lastSync as Record<string, unknown> | null) ?? {};
    await db
      .update(googleConnections)
      .set({ lastSync: { ...last, calendar: { ...total, failures: total.failures.slice(0, 20) } } })
      .where(eq(googleConnections.id, connection.id));
  }
  return any ? total : null;
}

/** Admin ("Sync now"): the company calendar and everyone's personal calendars. */
export async function syncCalendarsNow(actor: Actor): Promise<CalendarSyncSummary> {
  assertCan(actor, "google.manage");
  return (await syncCalendars(actor.orgId)) ?? { created: 0, updated: 0, removed: 0, failures: [] };
}

/** For the Integrations card: the company calendar, if any. */
export async function companyCalendarStatus(orgId: string) {
  const connection = await companyConnection(orgId);
  if (!connection) return null;
  const last = (connection.lastSync as { calendar?: CalendarSyncSummary } | null)?.calendar ?? null;
  return {
    allowed: hasScope(connection, COMPANY_CALENDAR_SCOPE),
    url: connection.calendarId ? calendarUrl(connection.calendarId) : null,
    sharedWith: ((connection.calendarSharedWith as string[]) ?? []).length,
    last,
  };
}

// --- Personal connection -----------------------------------------------------------------------

/** Anyone: finishes "Connect my Google Calendar" (the OAuth callback). Returns the account's email. */
export async function completePersonalConnect(actor: Actor, input: { code: string; verifier: string }, request?: RequestMeta): Promise<string> {
  const config = googleConfig();
  if (!config) throw new ServiceError("Google is not set up on this environment.");
  const tokens = await exchangeCode(config, { code: input.code, verifier: input.verifier, redirectUri: googleRedirectUri() });
  if (!tokens.scope.split(" ").includes(PERSONAL_CALENDAR_SCOPE)) {
    await revokeToken(config, tokens.access_token);
    throw new ServiceError("Calendar access was not allowed. Connect again and leave the Calendar box ticked.");
  }
  if (!tokens.refresh_token) throw new ServiceError("Google did not return a lasting sign-in. Connect again.");
  const email = await userEmail(config, tokens.access_token);
  const sealed = sealSecret(tokens.refresh_token);
  const replaced = await db.transaction(async (tx) => {
    const mine = and(eq(googleConnections.organizationId, actor.orgId), eq(googleConnections.userId, actor.id), eq(googleConnections.kind, "PERSONAL"));
    const [active] = await tx.select().from(googleConnections).where(and(mine, isNull(googleConnections.disconnectedAt))).for("update");
    const fresh = { googleEmail: email, refreshTokenEnc: sealed, scopes: tokens.scope, connectedAt: new Date(), disconnectedAt: null, lastError: null, lastErrorAt: null };
    let row: Connection;
    if (active) {
      // Same person, maybe another Google account: a different account needs a new calendar.
      const sameAccount = active.googleEmail === email;
      [row] = await tx
        .update(googleConnections)
        .set({ ...fresh, ...(sameAccount ? {} : { calendarId: null, calendarSharedWith: [] }) })
        .where(eq(googleConnections.id, active.id))
        .returning();
      if (!sameAccount) await tx.delete(calendarEvents).where(eq(calendarEvents.connectionId, active.id));
    } else {
      const [previous] = await tx.select().from(googleConnections).where(and(mine, eq(googleConnections.googleEmail, email))).orderBy(desc(googleConnections.connectedAt)).limit(1);
      [row] = previous
        ? await tx.update(googleConnections).set(fresh).where(eq(googleConnections.id, previous.id)).returning()
        : await tx.insert(googleConnections).values({ organizationId: actor.orgId, kind: "PERSONAL", userId: actor.id, ...fresh }).returning();
    }
    await recordAudit(tx, { actorId: actor.id, entityType: "google_connection", entityId: row.id, action: "google.personal_connected", after: { googleEmail: email }, request, organizationId: actor.orgId });
    return active && active.googleEmail !== email ? active : null;
  });
  if (replaced) await revokeToken(config, openSecret(replaced.refreshTokenEnc));
  await syncPersonalCalendar(actor.orgId, actor.id).catch((error) => console.error("Personal calendar sync after connecting failed", describeError(error)));
  return email;
}

export async function disconnectPersonal(actor: Actor, request?: RequestMeta) {
  const connection = await personalConnection(actor.orgId, actor.id);
  if (!connection) throw new ServiceError("Your Google Calendar is not connected.");
  await db.transaction(async (tx) => {
    await tx.update(googleConnections).set({ disconnectedAt: new Date() }).where(eq(googleConnections.id, connection.id));
    await recordAudit(tx, { actorId: actor.id, entityType: "google_connection", entityId: connection.id, action: "google.personal_disconnected", request, organizationId: actor.orgId });
  });
  const config = googleConfig();
  if (config) await revokeToken(config, openSecret(connection.refreshTokenEnc));
}

/** For the Account page. */
export async function personalCalendarStatus(actor: Actor) {
  const connection = await personalConnection(actor.orgId, actor.id);
  if (!connection) return null;
  return {
    googleEmail: connection.googleEmail,
    connectedAt: connection.connectedAt,
    lastSyncAt: connection.lastSyncAt,
    lastError: connection.lastError,
    url: connection.calendarId ? calendarUrl(connection.calendarId) : null,
  };
}

export async function syncMyCalendarNow(actor: Actor): Promise<CalendarSyncSummary> {
  try {
    const result = await syncPersonalCalendar(actor.orgId, actor.id);
    if (!result) throw new ServiceError("Your Google Calendar is not connected.");
    return result;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(describeError(error));
  }
}

// --- Project meetings --------------------------------------------------------------------------

/** "2026-10-08" + "14:30" in the operating time zone → the instant. */
export function zonedTime(date: string, time: string, timeZone = TIME_ZONE): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const asZone = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(guess.getTime() - (asZone - guess.getTime()));
}

export const meetingInput = z.object({
  title: z.string().trim().min(2, "Give the meeting a title").max(200),
  agenda: z.string().trim().max(2000).optional().transform((v) => v || null),
  date: z.iso.date("Pick a date"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a start time"),
  durationMinutes: z.coerce.number().int().min(15, "15 minutes to 8 hours").max(480, "15 minutes to 8 hours"),
});

/** Whether meetings can be scheduled (the company account is connected and allowed Calendar). */
export async function meetingsAvailable(orgId: string) {
  const connection = await companyConnection(orgId);
  return !!connection && hasScope(connection, COMPANY_CALENDAR_SCOPE) && googleConfig() !== null;
}

/** The people invited to a project's meetings: owner, assigned members and task assignees. */
async function projectTeamEmails(projectId: string): Promise<string[]> {
  const rows = await db.execute<{ email: string }>(sql`
    SELECT DISTINCT coalesce(g.google_email, u.email) AS email
    FROM users u
    JOIN memberships m ON m.user_id = u.id AND m.active AND u.active
    JOIN projects p ON p.id = ${projectId} AND m.organization_id = p.organization_id
    LEFT JOIN google_connections g ON g.user_id = u.id AND g.organization_id = p.organization_id AND g.kind = 'PERSONAL' AND g.disconnected_at IS NULL
    WHERE u.id = p.project_owner_id
       OR u.id IN (SELECT member_id FROM project_assignments WHERE project_id = ${projectId} AND active)
       OR u.id IN (SELECT assigned_to FROM tasks WHERE project_id = ${projectId} AND assigned_to IS NOT NULL)
  `);
  return rows.rows.map((r) => r.email.toLowerCase());
}

/** Managers: schedules a meeting with a Google Meet link and invites the project team. */
export async function scheduleMeeting(actor: Actor, projectId: string, raw: z.input<typeof meetingInput>, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const input = meetingInput.parse(raw);
  const startsAt = zonedTime(input.date, input.time);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
  if (startsAt.getTime() < Date.now() - 5 * 60_000) throw new ServiceError("Pick a time in the future.");
  const connection = await companyConnection(actor.orgId);
  if (!connection || !hasScope(connection, COMPANY_CALENDAR_SCOPE)) {
    throw new ServiceError("Google Calendar isn't connected. An Admin connects the company Google account on the Integrations page.");
  }
  const s = await session(connection);
  if (!s) throw new ServiceError("Google is not set up on this environment.");
  return withActor(actor, async (tx) => {
    const [project] = await tx.select({ code: projects.code, name: projects.name }).from(projects).where(eq(projects.id, projectId));
    if (!project) throw new ServiceError("Project not found.");
    const [meeting] = await tx
      .insert(projectMeetings)
      .values({ projectId, title: input.title, agenda: input.agenda, startsAt, endsAt, createdBy: actor.id })
      .returning()
      .catch(rethrowDbGuard);
    let calendarId: string;
    let event;
    try {
      calendarId = await ensureCalendar(s, `${await orgName(actor.orgId)}: projects and deadlines`);
      event = await call(s, (t) =>
        insertEvent(
          s.config,
          t,
          calendarId,
          {
            summary: `${project.code}: ${input.title}`,
            description: [input.agenda, `Project: ${project.name} — ${appLink(`/projects/${projectId}`)}`].filter(Boolean).join("\n\n"),
            start: startsAt,
            end: endsAt,
            timeZone: TIME_ZONE,
            attendees: [],
            meet: true,
          },
          { requestId: meeting.id, notify: false },
        ),
      );
    } catch (error) {
      throw new ServiceError(`Google Calendar refused the meeting: ${describeError(error)}`);
    }
    const attendees = await projectTeamEmails(projectId);
    // Invitations go out once the Meet link exists.
    if (attendees.length) {
      await call(s, (t) => inviteToEvent(s.config, t, calendarId, event.id, attendees)).catch((error) => console.error("Meeting invitations failed", describeError(error)));
    }
    const [saved] = await tx
      .update(projectMeetings)
      .set({ googleEventId: event.id, meetUrl: event.hangoutLink ?? null })
      .where(eq(projectMeetings.id, meeting.id))
      .returning();
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project_meeting",
      entityId: meeting.id,
      projectId,
      action: "meeting.scheduled",
      after: { title: input.title, startsAt, endsAt, invited: attendees.length },
      request,
    });
    return saved;
  });
}

/** Managers: cancels a meeting; Google tells everyone invited. */
export async function cancelMeeting(actor: Actor, meetingId: string, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  await withActor(actor, async (tx) => {
    const [meeting] = await tx.select().from(projectMeetings).where(eq(projectMeetings.id, meetingId));
    if (!meeting || meeting.cancelledAt) throw new ServiceError("Meeting not found.");
    const connection = await companyConnection(actor.orgId);
    if (meeting.googleEventId && connection?.calendarId) {
      const s = await session(connection);
      if (s) {
        await call(s, (t) => deleteEvent(s.config, t, connection.calendarId!, meeting.googleEventId!, true)).catch((error) => {
          throw new ServiceError(`Google Calendar refused: ${describeError(error)}`);
        });
      }
    }
    await tx.update(projectMeetings).set({ cancelledAt: new Date(), cancelledBy: actor.id }).where(eq(projectMeetings.id, meetingId)).catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "project_meeting", entityId: meetingId, projectId: meeting.projectId, action: "meeting.cancelled", before: { title: meeting.title, startsAt: meeting.startsAt }, request });
  });
}

/** Upcoming (and today's) meetings of a project, for anyone who can see it. */
export async function listMeetings(actor: Actor, projectId: string) {
  return withActor(actor, (tx) =>
    tx
      .select({ meeting: projectMeetings, by: users.name })
      .from(projectMeetings)
      .innerJoin(users, eq(users.id, projectMeetings.createdBy))
      .where(and(eq(projectMeetings.projectId, projectId), isNull(projectMeetings.cancelledAt), gt(projectMeetings.endsAt, new Date(Date.now() - 12 * 3_600_000))))
      .orderBy(asc(projectMeetings.startsAt))
      .limit(20),
  );
}

