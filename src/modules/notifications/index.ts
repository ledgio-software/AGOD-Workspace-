import { and, desc, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { notifications } from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions";

export type NotificationInput = {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
};

/** In-app notification, written in the caller's transaction. No self-notifications. */
export async function notify(tx: Tx, actor: Actor, input: NotificationInput): Promise<void> {
  if (input.recipientId === actor.id) return;
  await tx.insert(notifications).values({
    recipientId: input.recipientId,
    type: input.type,
    title: input.title,
    message: input.message,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
  });
}

export async function listMyNotifications(actor: Actor, limit = 30) {
  return withActor(actor, (tx) =>
    tx
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, actor.id))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
  );
}

export async function markAllNotificationsRead(actor: Actor): Promise<void> {
  await withActor(actor, (tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.recipientId, actor.id), isNull(notifications.readAt))),
  );
}
