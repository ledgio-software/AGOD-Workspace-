import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobRuns, notificationPreferences, notifications, users } from "@/lib/db/schema";
import { type EmailConfig, emailConfig, sendEmail } from "@/lib/email";
import { resolveBaseUrl } from "@/lib/env";
import { withActor } from "@/lib/db/actor";
import { type Actor, assertCan } from "@/lib/permissions";
import { ServiceError } from "@/modules/errors";
import { buildDigest } from "@/modules/email/digest";
import { refreshDeadlineAlerts } from "@/modules/notifications/deadlines";
import { refreshRenewalAlerts } from "@/modules/subscriptions";

// Phase 19: the daily job (Vercel Cron → /api/cron/daily). It creates every active person's task,
// approval and renewal reminders (the same ones the app creates when they open it), then emails
// each person who wants it one summary of their unread notifications not emailed before.
// Runs through the owner connection like the GitHub webhook; reminders are created as each person,
// under their own permissions.

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
};

export async function runDailyReminders(
  options: { now?: Date; email?: EmailConfig | null; /** Limits the run to these people (tests). */ userIds?: string[] } = {},
): Promise<DailySummary> {
  const now = options.now ?? new Date();
  const email = options.email === undefined ? emailConfig() : options.email;
  const [run] = await db.insert(jobRuns).values({ job: DAILY_JOB, startedAt: now }).returning({ id: jobRuns.id });
  try {
    const people = await db
      .select({ id: users.id, role: users.role, name: users.name, email: users.email, dailyEmail: notificationPreferences.dailyEmail })
      .from(users)
      .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
      .where(options.userIds ? and(eq(users.active, true), inArray(users.id, options.userIds)) : eq(users.active, true))
      .orderBy(asc(users.createdAt));

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
      const actor: Actor = { id: person.id, role: person.role };
      try {
        summary.remindersCreated += (await refreshDeadlineAlerts(actor, now)) + (await refreshRenewalAlerts(actor));
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
        const result = await emailPerson(email, person, baseUrl, now);
        if (result === "sent") summary.emailsSent += 1;
        if (result === "failed") summary.emailFailures += 1;
      }
    }

    await db
      .update(jobRuns)
      .set({ finishedAt: new Date(), ok: summary.reminderFailures === 0 && summary.emailFailures === 0, summary })
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
  person: { id: string; name: string; email: string },
  baseUrl: string,
  now: Date,
): Promise<"sent" | "none" | "failed"> {
  const since = new Date(now.getTime() - EMAIL_LOOKBACK_DAYS * 86_400_000);
  const pending = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.recipientId, person.id), isNull(notifications.emailedAt), isNull(notifications.readAt), gt(notifications.createdAt, since)))
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
    await sendEmail(email, { to: person.email, ...buildDigest({ name: person.name, items: claimed, baseUrl }) });
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
  const message = buildDigest({
    name: me.name,
    baseUrl: resolveBaseUrl(process.env) ?? "",
    items: [{ title: "Test email", message: "Email from AGOD is working.", entityType: null, entityId: null }],
  });
  try {
    await sendEmail(email, { to: me.email, ...message, subject: "AGOD: test email" });
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "The email could not be sent.");
  }
}

/** Admin: run the daily job now (e.g. to check it on staging). */
export async function runDailyRemindersNow(actor: Actor): Promise<DailySummary> {
  assertCan(actor, "audit.viewAll");
  return runDailyReminders();
}


