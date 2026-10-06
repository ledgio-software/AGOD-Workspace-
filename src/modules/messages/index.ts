import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { conversationMembers, conversations, messages, notifications, orgMembers } from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";

// Phase 30: in-app messages between people of the same company. One-to-one conversations (one per
// pair, reused) and small groups (up to 10 people). Everyone in the company may message anyone in
// it; only the people in a conversation can read it, Admins included (row-level security).

export const MAX_GROUP = 10;
const PAGE = 100;

export type ConversationSummary = {
  id: string;
  title: string;
  isGroup: boolean;
  people: { id: string; name: string }[];
  lastMessageAt: Date;
  lastMessage: { authorName: string; body: string; mine: boolean } | null;
  unread: number;
};

export type Message = { id: string; authorId: string; authorName: string; body: string; createdAt: Date };

/** A conversation's name: its title, or the other people's names. */
function nameOf(title: string | null, others: { name: string }[]) {
  if (title) return title;
  if (others.length === 0) return "Just you";
  return others.map((o) => o.name).join(", ");
}

async function peopleOf(tx: Tx, conversationIds: string[]) {
  if (conversationIds.length === 0) return new Map<string, { id: string; name: string }[]>();
  const rows = await tx
    .select({ conversationId: conversationMembers.conversationId, id: orgMembers.id, name: orgMembers.name })
    .from(conversationMembers)
    .innerJoin(orgMembers, eq(orgMembers.id, conversationMembers.userId))
    .where(inArray(conversationMembers.conversationId, conversationIds))
    .orderBy(asc(orgMembers.name));
  const map = new Map<string, { id: string; name: string }[]>();
  for (const r of rows) map.set(r.conversationId, [...(map.get(r.conversationId) ?? []), { id: r.id, name: r.name }]);
  return map;
}

/** My conversations, most recent first, with the last message and how many I haven't read. */
export async function listConversations(actor: Actor): Promise<ConversationSummary[]> {
  return withActor(actor, async (tx) => {
    const mine = await tx
      .select({ id: conversations.id, title: conversations.title, lastMessageAt: conversations.lastMessageAt, lastReadAt: conversationMembers.lastReadAt })
      .from(conversations)
      .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, actor.id)))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(200);
    if (mine.length === 0) return [];
    const ids = mine.map((c) => c.id);
    const people = await peopleOf(tx, ids);
    const unread = await tx.execute<{ conversation_id: string; n: number }>(sql`
      select m.conversation_id, count(*)::int as n
      from messages m join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${actor.id}
      where m.conversation_id in ${ids} and m.author_id <> ${actor.id} and m.created_at > cm.last_read_at
      group by m.conversation_id`);
    const unreadBy = new Map(unread.rows.map((r) => [r.conversation_id, r.n]));
    const last = await tx.execute<{ conversation_id: string; body: string; author_id: string; author_name: string }>(sql`
      select distinct on (m.conversation_id) m.conversation_id, m.body, m.author_id, u.name as author_name
      from messages m join users u on u.id = m.author_id
      where m.conversation_id in ${ids}
      order by m.conversation_id, m.created_at desc`);
    const lastBy = new Map(last.rows.map((r) => [r.conversation_id, r]));
    return mine.map((c) => {
      const everyone = people.get(c.id) ?? [];
      const others = everyone.filter((p) => p.id !== actor.id);
      const l = lastBy.get(c.id);
      return {
        id: c.id,
        title: nameOf(c.title, others),
        isGroup: everyone.length > 2 || c.title !== null,
        people: everyone,
        lastMessageAt: c.lastMessageAt,
        lastMessage: l ? { authorName: l.author_name, body: l.body, mine: l.author_id === actor.id } : null,
        unread: unreadBy.get(c.id) ?? 0,
      };
    });
  });
}

/** Messages I haven't read yet, across my conversations (for the message icon). */
export async function unreadMessageCount(actor: Actor): Promise<number> {
  return withActor(actor, async (tx) => {
    const [row] = (
      await tx.execute<{ n: number }>(sql`
        select count(*)::int as n
        from messages m join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${actor.id}
        where m.author_id <> ${actor.id} and m.created_at > cm.last_read_at`)
    ).rows;
    return row?.n ?? 0;
  });
}

export const startInput = z.object({
  memberIds: z.array(z.uuid()).min(1, "Choose at least one person").max(MAX_GROUP - 1, `A conversation has at most ${MAX_GROUP} people`),
  title: z
    .string()
    .trim()
    .max(80)
    .transform((v) => (v === "" ? null : v))
    .nullish(),
  body: z
    .string()
    .trim()
    .max(4000, "Keep a message under 4,000 characters")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
});

/**
 * Starts a conversation with these people (all active in the company), or reopens the existing
 * one-to-one conversation with that person. Optionally sends the first message. Returns its id.
 */
export async function startConversation(actor: Actor, raw: z.input<typeof startInput>): Promise<string> {
  const input = startInput.parse(raw);
  const others = [...new Set(input.memberIds)].filter((id) => id !== actor.id);
  if (others.length === 0) throw new ServiceError("Choose someone to message.");
  if (input.title && input.title.length < 2) throw new ServiceError("A group name needs at least 2 characters.");
  return withActor(actor, async (tx) => {
    const active = await tx.select({ id: orgMembers.id }).from(orgMembers).where(and(inArray(orgMembers.id, others), eq(orgMembers.active, true)));
    if (active.length !== others.length) throw new ServiceError("Everyone in a conversation must be an active member of this company.");
    let id: string | null = null;
    if (others.length === 1 && !input.title) id = await existingDirect(tx, actor.id, others[0]);
    if (!id) {
      const [created] = await tx.insert(conversations).values({ title: input.title ?? null, createdBy: actor.id }).returning({ id: conversations.id }).catch(rethrowDbGuard);
      id = created.id;
      await tx
        .insert(conversationMembers)
        // The others haven't read anything yet (not "now", which could differ from message times).
        .values([actor.id, ...others].map((userId) => ({ conversationId: id!, userId, lastReadAt: userId === actor.id ? new Date() : new Date(0) })))
        .catch(rethrowDbGuard);
    }
    if (input.body) await sendTx(tx, actor, id, input.body);
    return id;
  });
}

/** The one-to-one conversation (no title, exactly these two people), if there is one. */
async function existingDirect(tx: Tx, me: string, other: string): Promise<string | null> {
  const rows = await tx.execute<{ id: string }>(sql`
    select c.id from conversations c
    where c.title is null
      and exists (select 1 from conversation_members m where m.conversation_id = c.id and m.user_id = ${me})
      and exists (select 1 from conversation_members m where m.conversation_id = c.id and m.user_id = ${other})
      and (select count(*) from conversation_members m where m.conversation_id = c.id) = 2
    limit 1`);
  return rows.rows[0]?.id ?? null;
}

/** A conversation with its people and latest messages (oldest first); marks it read. Null if I'm not in it. */
export async function openConversation(actor: Actor, conversationId: string) {
  if (!z.uuid().safeParse(conversationId).success) return null;
  return withActor(actor, async (tx) => {
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!c) return null;
    const people = (await peopleOf(tx, [c.id])).get(c.id) ?? [];
    if (!people.some((p) => p.id === actor.id)) return null;
    const rows = await tx
      .select({ id: messages.id, authorId: messages.authorId, body: messages.body, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.conversationId, c.id))
      .orderBy(desc(messages.createdAt))
      .limit(PAGE);
    const names = new Map(people.map((p) => [p.id, p.name]));
    await tx
      .update(conversationMembers)
      .set({ lastReadAt: new Date() })
      .where(and(eq(conversationMembers.conversationId, c.id), eq(conversationMembers.userId, actor.id)));
    const others = people.filter((p) => p.id !== actor.id);
    return {
      id: c.id,
      title: nameOf(c.title, others),
      isGroup: people.length > 2 || c.title !== null,
      people,
      truncated: rows.length === PAGE,
      messages: rows.reverse().map((m) => ({ ...m, authorName: names.get(m.authorId) ?? "Former member" })) as Message[],
    };
  });
}

export const messageInput = z.object({ body: z.string().trim().min(1, "Write a message").max(4000, "Keep a message under 4,000 characters") });

async function sendTx(tx: Tx, actor: Actor, conversationId: string, body: string) {
  const now = new Date();
  await tx.insert(messages).values({ conversationId, authorId: actor.id, body, createdAt: now }).catch(rethrowDbGuard);
  await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
  // Writing a message means I've read the conversation up to now.
  await tx
    .update(conversationMembers)
    .set({ lastReadAt: now })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, actor.id)));
}

export async function sendMessage(actor: Actor, conversationId: string, raw: z.input<typeof messageInput>) {
  const { body } = messageInput.parse(raw);
  await withActor(actor, async (tx) => {
    const [me] = await tx
      .select({ id: conversationMembers.id })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, actor.id)));
    if (!me) throw new ServiceError("Conversation not found.");
    // Nobody writes into a conversation whose other people have all left the company.
    const others = await tx
      .select({ id: orgMembers.id })
      .from(conversationMembers)
      .innerJoin(orgMembers, eq(orgMembers.id, conversationMembers.userId))
      .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, actor.id), eq(orgMembers.active, true)));
    if (others.length === 0) throw new ServiceError("Nobody else in this conversation is still in the company.");
    await sendTx(tx, actor, conversationId, body);
  });
}

/** People I can start a conversation with: active members of this company, except me. */
export async function messageablePeople(actor: Actor) {
  return withActor(actor, (tx) =>
    tx
      .select({ id: orgMembers.id, name: orgMembers.name, email: orgMembers.email })
      .from(orgMembers)
      .where(and(eq(orgMembers.active, true), ne(orgMembers.id, actor.id)))
      .orderBy(asc(orgMembers.name)),
  );
}

/** For the daily email: unread messages older than an hour (so people who are online aren't emailed). */
export async function unreadForDigest(tx: Tx, userId: string, orgId: string, olderThan: Date): Promise<number> {
  const [row] = (
    await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
      from messages m join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${userId}
      where m.organization_id = ${orgId} and m.author_id <> ${userId} and m.created_at > cm.last_read_at and m.created_at < ${olderThan}`)
  ).rows;
  return row?.n ?? 0;
}


/**
 * The daily job: if I have messages unread for over an hour, one notification a day saying so
 * (it appears in My work and in the daily email, which links to the conversation). Returns 1 if created.
 */
export async function refreshMessageAlert(actor: Actor, now: Date = new Date()): Promise<number> {
  return withActor(actor, async (tx) => {
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const count = await unreadForDigest(tx, actor.id, actor.orgId, hourAgo);
    if (count === 0) return 0;
    const [latest] = (
      await tx.execute<{ conversation_id: string }>(sql`
        select m.conversation_id
        from messages m join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${actor.id}
        where m.author_id <> ${actor.id} and m.created_at > cm.last_read_at
        order by m.created_at desc limit 1`)
    ).rows;
    const inserted = await tx
      .insert(notifications)
      .values({
        recipientId: actor.id,
        type: "messages.unread",
        title: count === 1 ? "You have an unread message" : `You have ${count} unread messages`,
        message: "Open Messages to read and reply.",
        entityType: "conversation",
        entityId: latest?.conversation_id ?? null,
        dedupeKey: `messages:${now.toISOString().slice(0, 10)}`,
      })
      .onConflictDoNothing({ target: [notifications.recipientId, notifications.dedupeKey], where: sql`${notifications.dedupeKey} IS NOT NULL` })
      .returning({ id: notifications.id });
    return inserted.length;
  });
}
