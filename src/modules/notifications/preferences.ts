import { eq } from "drizzle-orm";
import { withActor } from "@/lib/db/actor";
import { notificationPreferences } from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions";
import { recordAudit, type RequestMeta } from "@/modules/audit";

/** Phase 19: whether the person gets the daily email (on unless they turned it off). */
export async function getDailyEmail(actor: Actor): Promise<boolean> {
  return withActor(actor, async (tx) => {
    const [row] = await tx.select().from(notificationPreferences).where(eq(notificationPreferences.userId, actor.id));
    return row?.dailyEmail ?? true;
  });
}

export async function setDailyEmail(actor: Actor, dailyEmail: boolean, request?: RequestMeta): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .insert(notificationPreferences)
      .values({ userId: actor.id, dailyEmail })
      .onConflictDoUpdate({ target: notificationPreferences.userId, set: { dailyEmail, updatedAt: new Date() } });
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "user",
      entityId: actor.id,
      action: dailyEmail ? "user.daily_email_on" : "user.daily_email_off",
      request,
    });
  });
}
