import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobRuns, memberships, notificationPreferences, notifications, organizations, users } from "@/lib/db/schema";
import { type EmailConfig, emailConfig, sendEmail } from "@/lib/email";
import { resolveBaseUrl } from "@/lib/env";
import { withActor } from "@/lib/db/actor";
import { type Actor, assertCan } from "@/lib/permissions";
import { ServiceError } from "@/modules/errors";
import { buildDigest } from "@/modules/email/digest";
import { syncDrive } from "@/modules/google";
import { syncCalendars } from "@/modules/google/calendar";
import { refreshDeadlineAlerts } from "@/modules/notifications/deadlines";
import { refreshInvoiceAlerts } from "@/modules/invoices";
import { refreshMessageAlert } from "@/modules/messages";
import { refreshRenewalAlerts } from "@/modules/subscriptions";

// Phase 19: the daily job (Vercel Cron → /api/cron/daily). It creates every active person's task,
// approval and renewal reminders (the same ones the app creates when they open it), then emails
// each person who wants it one summary of their unread notifications not emailed before.
// Runs through the owner connection like the GitHub webhook; reminders are created as each person,
// under their own permissions. Phase 21: then it creates and shares the Google Drive folders.
// Phase 22: once per company; people in several companies get one email from each.

export const DAILY_JOB = "daily-reminders";
/** Only recent notifications are emailed, so turning email on doesn't send a long backlog. */
export const EMAIL_LOOKBACK_DAYS = 7;
const MAX_ITEMS_PER_EMAIL = 30;

export type DailySummary = {
  people: number;
  remindersCreated: number;
  reminderFailures: number;
  email: "sent" | "off";
  emailsSent: number;
  emailFailures: number;
  emailsSkipped: number;
  /** Phase 21: Drive folder and sharing sync; absent when Google isn't connected. */
  drive?: { folders: number; shared: number; unshared: number; failures: number } | { error: string };
  /** Phase 24: company and personal calendars; absent when there are none. */
  calendar?: { created: number; updated: number; removed: number; failures: number } | { error: string };
};

export type DailyRunOptions = {
  now?: Date;
  email?: EmailConfig | null;
  /** Limits the run to these people (tests). */
  userIds?: string[];
  /** Limits the run to these companies (default: every company). */
  orgIds?: string[];
  drive?: boolean;
};

/**
 * Phase 22: runs each company in turn (its own run record, people, reminders, emails and Drive),
 * so one company's problem never stops another's. Returns the totals.
 */
export async function runDailyReminders(options: DailyRunOptions = {}): Promise<DailySummary> {
  const companies = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    // Phase 40: suspended companies get no reminders or emails.
    .where(and(isNull(organizations.suspendedAt), options.orgIds ? inArray(organizations.id, options.orgIds) : undefined))
    .orderBy(asc(organizations.createdAt));
  const total: DailySummary = { people: 0, remindersCreated: 0, reminderFailures: 0, email: "off", emailsSent: 0, emailFailures: 0, emailsSkipped: 0 };
  for (const company of companies) {
    const s = await runCompany(company, options);
    total.people += s.people;
    total.remindersCreated += s.remindersCreated;
    total.reminderFailures += s.reminderFailures;
    total.email = s.email;
    total.emailsSent += s.emailsSent;
    total.emailFailures += s.emailFailures;
    total.emailsSkipped += s.emailsSkipped;
    if (s.drive) {
      const d = total.drive && "folders" in total.drive ? total.drive : { folders: 0, shared: 0, unshared: 0, failures: 0 };
      total.drive =
        "error" in s.drive
          ? { ...d, failures: d.failures + 1 }
          : { folders: d.folders + s.drive.folders, shared: d.shared + s.drive.shared, unshared: d.unshared + s.drive.unshared, failures: d.failures + s.drive.failures };
    }
    if (s.calendar) {
      const c = total.calendar && "created" in total.calendar ? total.calendar : { created: 0, updated: 0, removed: 0, failures: 0 };
      total.calendar =
        "error" in s.calendar
          ? { ...c, failures: c.failures + 1 }
          : { created: c.created + s.calendar.created, updated: c.updated + s.calendar.updated, removed: c.removed + s.calendar.removed, failures: c.failures + s.calendar.failures };
    }
  }
  return total;
}

async function runCompany(company: { id: string; name: string }, options: DailyRunOptions): Promise<DailySummary> {
  const now = options.now ?? new Date();
  const email = options.email === undefined ? emailConfig() : options.email;
  const [run] = await db.insert(jobRuns).values({ organizationId: company.id, job: DAILY_JOB, startedAt: now }).returning({ id: jobRuns.id });
  try {
    const active = and(eq(memberships.organizationId, company.id), eq(memberships.active, true), eq(users.active, true));
    const people = await db
      .select({ id: users.id, role: memberships.role, name: users.name, email: users.email, dailyEmail: notificationPreferences.dailyEmail })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
      .where(options.userIds ? and(active, inArray(users.id, options.userIds)) : active)
      .orderBy(asc(memberships.createdAt));

    const summary: DailySummary = {
      people: people.length,
      remindersCreated: 0,
      reminderFailures: 0,
      email: email ? "sent" : "off",
      emailsSent: 0,
      emailFailures: 0,
      emailsSkipped: 0,
    };

    for (const person of people) {
      const actor: Actor = { id: person.id, role: person.role, orgId: company.id };
      try {
        summary.remindersCreated +=
          (await refreshDeadlineAlerts(actor, now)) + (await refreshRenewalAlerts(actor)) + (await refreshInvoiceAlerts(actor)) + (await refreshMessageAlert(actor, now));
      } catch (error) {
        summary.reminderFailures += 1;
        console.error("Daily reminders failed for a user", person.id, error instanceof Error ? error.message : error);
      }
    }

    if (email) {
      const baseUrl = resolveBaseUrl(process.env) ?? "";
      for (const person of people) {
        if (person.dailyEmail === false) {
          summary.emailsSkipped += 1;
          continue;
        }
        const result = await emailPerson(email, company, person, baseUrl, now);
        if (result === "sent") summary.emailsSent += 1;
        if (result === "failed") summary.emailFailures += 1;
      }
    }

    if (options.drive !== false) {
      try {
        const drive = await syncDrive(company.id);
        if (drive) summary.drive = { folders: drive.folders, shared: drive.shared, unshared: drive.unshared, failures: drive.failures.length };
      } catch (error) {
        summary.drive = { error: error instanceof Error ? error.message.slice(0, 300) : String(error) };
        console.error("Drive sync failed", company.id, summary.drive.error);
      }
      try {
        const calendar = await syncCalendars(company.id);
        if (calendar) summary.calendar = { created: calendar.created, updated: calendar.updated, removed: calendar.removed, failures: calendar.failures.length };
      } catch (error) {
        summary.calendar = { error: error instanceof Error ? error.message.slice(0, 300) : String(error) };
        console.error("Calendar sync failed", company.id, summary.calendar.error);
      }
    }

    await db
      .update(jobRuns)
      .set({ finishedAt: new Date(), ok: summary.reminderFailures === 0 && summary.emailFailures === 0 && !(summary.drive && "error" in summary.drive) && !(summary.calendar && "error" in summary.calendar), summary })
      .where(eq(jobRuns.id, run.id));
    return summary;
  } catch (error) {
    await db
      .update(jobRuns)
      .set({ finishedAt: new Date(), ok: false, error: error instanceof Error ? error.message.slice(0, 1000) : String(error) })
      .where(eq(jobRuns.id, run.id));
    throw error;
  }
}

/**
 * Claims the person's unread, not-yet-emailed recent notifications (so a retried or overlapping
 * run can't send them twice), emails them, and releases the claim if sending fails.
 */
async function emailPerson(
  email: EmailConfig,
  company: { id: string; name: string },
  person: { id: string; name: string; email: string },
  baseUrl: string,
  now: Date,
): Promise<"sent" | "none" | "failed"> {
  const since = new Date(now.getTime() - EMAIL_LOOKBACK_DAYS * 86_400_000);
  const pending = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, company.id),
        eq(notifications.recipientId, person.id),
        isNull(notifications.emailedAt),
        isNull(notifications.readAt),
        gt(notifications.createdAt, since),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(MAX_ITEMS_PER_EMAIL);
  if (pending.length === 0) return "none";
  const claimed = await db
    .update(notifications)
    .set({ emailedAt: now })
    .where(and(inArray(notifications.id, pending.map((p) => p.id)), isNull(notifications.emailedAt)))
    .returning({ id: notifications.id, title: notifications.title, message: notifications.message, entityType: notifications.entityType, entityId: notifications.entityId, createdAt: notifications.createdAt });
  if (claimed.length === 0) return "none";
  claimed.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  try {
    await sendEmail(email, { to: person.email, ...buildDigest({ name: person.name, items: claimed, baseUrl, company: company.name }) });
    return "sent";
  } catch (error) {
    await db.update(notifications).set({ emailedAt: null }).where(inArray(notifications.id, claimed.map((c) => c.id)));
    console.error("Daily email failed", person.id, error instanceof Error ? error.message : error);
    return "failed";
  }
}

/** Admin page: the latest runs, newest first (row-level security limits this to Admins). */
export async function recentJobRuns(actor: Actor, limit = 10) {
  assertCan(actor, "audit.viewAll");
  return withActor(actor, (tx) => tx.select().from(jobRuns).where(eq(jobRuns.job, DAILY_JOB)).orderBy(desc(jobRuns.startedAt)).limit(limit));
}

/** Admin: send yourself a sample email to check the settings. */
export async function sendTestEmail(actor: Actor): Promise<void> {
  assertCan(actor, "audit.viewAll");
  const email = emailConfig();
  if (!email) throw new ServiceError("Email is not set up on this environment.");
  const [me] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, actor.id));
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, actor.orgId));
  const message = buildDigest({
    name: me.name,
    company: org.name,
    baseUrl: resolveBaseUrl(process.env) ?? "",
    items: [{ title: "Test email", message: `Email from ${org.name} is working.`, entityType: null, entityId: null }],
  });
  try {
    await sendEmail(email, { to: me.email, ...message, subject: `${org.name}: test email` });
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "The email could not be sent.");
  }
}

/** Admin: run the daily job now (e.g. to check it on staging). */
export async function runDailyRemindersNow(actor: Actor): Promise<DailySummary> {
  assertCan(actor, "audit.viewAll");
  return runDailyReminders({ orgIds: [actor.orgId] });
}


