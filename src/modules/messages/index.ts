import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { conversationMembers, conversations, messageReactions, messages, notifications, orgMembers } from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions";
import { storage } from "@/lib/storage";
import { findMentions } from "@/modules/comments/mentions";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS, STICKERS, formatDuration, isReaction, isSticker } from "./catalog";

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

export type Reaction = { emoji: string; count: number; mine: boolean; names: string[] };

export type Message = {
  id: string;
  authorId: string;
  authorName: string;
  kind: "TEXT" | "STICKER" | "VOICE";
  body: string;
  sticker: string | null;
  voiceSeconds: number | null;
  mentionedIds: string[];
  reactions: Reaction[];
  createdAt: Date;
};

/** One line for the conversation list and notifications. */
export function previewOf(m: { kind: string; body: string; sticker: string | null; voice_seconds?: number | null; voiceSeconds?: number | null }): string {
  if (m.kind === "STICKER") return `Sticker: ${m.sticker && isSticker(m.sticker) ? `${STICKERS[m.sticker].emoji} ${STICKERS[m.sticker].label}` : ""}`;
  if (m.kind === "VOICE") return `🎤 Voice note (${formatDuration(m.voiceSeconds ?? m.voice_seconds ?? 0)})`;
  return m.body;
}

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
    const last = await tx.execute<{ conversation_id: string; kind: string; body: string; sticker: string | null; voice_seconds: number | null; author_id: string; author_name: string }>(sql`
      select distinct on (m.conversation_id) m.conversation_id, m.kind, m.body, m.sticker, m.voice_seconds, m.author_id, u.name as author_name
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
        lastMessage: l ? { authorName: l.author_name, body: previewOf(l), mine: l.author_id === actor.id } : null,
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
    if (input.body) await sendTx(tx, actor, id, { kind: "TEXT", body: input.body });
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
      .select({
        id: messages.id,
        authorId: messages.authorId,
        kind: messages.kind,
        body: messages.body,
        sticker: messages.sticker,
        voiceSeconds: messages.voiceSeconds,
        mentionedIds: messages.mentionedIds,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, c.id))
      .orderBy(desc(messages.createdAt))
      .limit(PAGE);
    const names = new Map(people.map((p) => [p.id, p.name]));
    const reactionRows = rows.length
      ? await tx
          .select({ messageId: messageReactions.messageId, userId: messageReactions.userId, emoji: messageReactions.emoji })
          .from(messageReactions)
          .where(inArray(messageReactions.messageId, rows.map((m) => m.id)))
          .orderBy(asc(messageReactions.createdAt))
      : [];
    const reactionsOf = (messageId: string): Reaction[] => {
      const byEmoji = new Map<string, Reaction>();
      for (const r of reactionRows.filter((x) => x.messageId === messageId)) {
        const entry = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, names: [] };
        entry.count++;
        entry.mine ||= r.userId === actor.id;
        entry.names.push(r.userId === actor.id ? "You" : (names.get(r.userId) ?? "Former member"));
        byEmoji.set(r.emoji, entry);
      }
      return [...byEmoji.values()];
    };
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
      messages: rows.reverse().map((m) => ({ ...m, authorName: names.get(m.authorId) ?? "Former member", reactions: reactionsOf(m.id) })) as Message[],
    };
  });
}

export const messageInput = z.object({ body: z.string().trim().min(1, "Write a message").max(4000, "Keep a message under 4,000 characters") });

type Content =
  | { kind: "TEXT"; body: string }
  | { kind: "STICKER"; sticker: string }
  | { kind: "VOICE"; voiceKey: string; voiceMime: string; voiceSeconds: number; voiceBytes: number };

/** Saves a message; people tagged with @name (who are in the conversation) get a notification. */
async function sendTx(tx: Tx, actor: Actor, conversationId: string, content: Content): Promise<string> {
  const now = new Date();
  let mentionedIds: string[] = [];
  if (content.kind === "TEXT" && content.body.includes("@")) {
    const people = await tx
      .select({ id: orgMembers.id, name: orgMembers.name, email: orgMembers.email })
      .from(conversationMembers)
      .innerJoin(orgMembers, eq(orgMembers.id, conversationMembers.userId))
      .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, actor.id)));
    mentionedIds = findMentions(content.body, people).slice(0, 10);
  }
  const values =
    content.kind === "TEXT"
      ? { body: content.body }
      : content.kind === "STICKER"
        ? { kind: "STICKER", body: "", sticker: content.sticker }
        : { kind: "VOICE", body: "", voiceKey: content.voiceKey, voiceMime: content.voiceMime, voiceSeconds: content.voiceSeconds, voiceBytes: content.voiceBytes };
  const [row] = await tx
    .insert(messages)
    .values({ conversationId, authorId: actor.id, mentionedIds, createdAt: now, ...values })
    .returning({ id: messages.id })
    .catch(rethrowDbGuard);
  await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
  // Writing a message means I've read the conversation up to now.
  await tx
    .update(conversationMembers)
    .set({ lastReadAt: now })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, actor.id)));
  if (mentionedIds.length > 0 && content.kind === "TEXT") {
    const [me] = await tx.select({ name: orgMembers.name }).from(orgMembers).where(eq(orgMembers.id, actor.id));
    const [c] = await tx.select({ title: conversations.title }).from(conversations).where(eq(conversations.id, conversationId));
    const text = content.body.length > 140 ? `${content.body.slice(0, 137)}…` : content.body;
    await tx.insert(notifications).values(
      mentionedIds.map((recipientId) => ({
        recipientId,
        type: "message.mention",
        title: `${me?.name ?? "Someone"} mentioned you${c?.title ? ` in ${c.title}` : ""}`,
        message: text,
        entityType: "conversation",
        entityId: conversationId,
      })),
    );
  }
  return row.id;
}

/** I'm in the conversation and someone else in it is still in the company. */
async function assertCanWrite(tx: Tx, actor: Actor, conversationId: string) {
  if (!z.uuid().safeParse(conversationId).success) throw new ServiceError("Conversation not found.");
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
}

export async function sendMessage(actor: Actor, conversationId: string, raw: z.input<typeof messageInput>) {
  const { body } = messageInput.parse(raw);
  await withActor(actor, async (tx) => {
    await assertCanWrite(tx, actor, conversationId);
    await sendTx(tx, actor, conversationId, { kind: "TEXT", body });
  });
}

/** Phase 34: sends one of the built-in stickers. */
export async function sendSticker(actor: Actor, conversationId: string, sticker: string) {
  if (!isSticker(sticker)) throw new ServiceError("Choose one of the stickers.");
  await withActor(actor, async (tx) => {
    await assertCanWrite(tx, actor, conversationId);
    await sendTx(tx, actor, conversationId, { kind: "STICKER", sticker });
  });
}

/** Whether voice notes can be stored in this environment. */
export const voiceNotesAvailable = () => storage() !== null;

/** The recording's real type, from its first bytes (not from what the browser says). */
export function voiceType(bytes: Uint8Array): { mime: string; ext: string } | null {
  const at = (i: number, ...b: number[]) => b.every((v, k) => bytes[i + k] === v);
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return { mime: "audio/webm", ext: "webm" };
  if (at(0, 0x4f, 0x67, 0x67, 0x53)) return { mime: "audio/ogg", ext: "ogg" };
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return { mime: "audio/mp4", ext: "m4a" };
  return null;
}

/** Phase 34: sends a recorded voice note (at most two minutes). Stored privately; only the conversation's people can play it. */
export async function sendVoiceNote(actor: Actor, conversationId: string, file: { bytes: Uint8Array; seconds: number }) {
  const seconds = Math.round(file.seconds);
  if (!Number.isFinite(seconds) || seconds < 1) throw new ServiceError("That recording is too short.");
  if (seconds > MAX_VOICE_SECONDS) throw new ServiceError(`Voice notes can be at most ${MAX_VOICE_SECONDS / 60} minutes.`);
  if (file.bytes.length < 100) throw new ServiceError("That recording is empty. Check your microphone and try again.");
  if (file.bytes.length > MAX_VOICE_BYTES) throw new ServiceError("That recording is too large.");
  const type = voiceType(file.bytes);
  if (!type) throw new ServiceError("That isn't a recording this app can play.");
  const store = storage();
  if (!store) throw new ServiceError("Voice notes are not set up in this environment yet.");
  // Check before storing anything.
  await withActor(actor, (tx) => assertCanWrite(tx, actor, conversationId));
  const key = await store.put(`messages/${actor.orgId}/${conversationId}/${randomUUID()}.${type.ext}`, file.bytes, type.mime);
  try {
    await withActor(actor, async (tx) => {
      await assertCanWrite(tx, actor, conversationId);
      await sendTx(tx, actor, conversationId, { kind: "VOICE", voiceKey: key, voiceMime: type.mime, voiceSeconds: seconds, voiceBytes: file.bytes.length });
    });
  } catch (error) {
    await store.remove(key).catch(() => undefined);
    throw error;
  }
}

/** For the playback route: the voice note, if I'm in its conversation. */
export async function openVoiceNote(actor: Actor, messageId: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  if (!z.uuid().safeParse(messageId).success) return null;
  const [row] = await withActor(actor, (tx) =>
    tx.select({ key: messages.voiceKey, mime: messages.voiceMime }).from(messages).where(and(eq(messages.id, messageId), eq(messages.kind, "VOICE"))),
  );
  if (!row?.key || !row.mime) return null;
  const file = await storage()?.get(row.key);
  if (!file) return null;
  const bytes = file.body instanceof Uint8Array ? file.body : new Uint8Array(await new Response(file.body).arrayBuffer());
  return { mime: row.mime, bytes };
}

/** Phase 34: adds my reaction to a message, or takes it back. Returns whether it's on now. */
export async function toggleReaction(actor: Actor, messageId: string, emoji: string): Promise<boolean> {
  if (!isReaction(emoji)) throw new ServiceError("Choose one of the reactions.");
  if (!z.uuid().safeParse(messageId).success) throw new ServiceError("Message not found.");
  return withActor(actor, async (tx) => {
    // Row-level security hides messages from conversations I'm not in.
    const [m] = await tx.select({ id: messages.id }).from(messages).where(eq(messages.id, messageId));
    if (!m) throw new ServiceError("Message not found.");
    const removed = await tx
      .delete(messageReactions)
      .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, actor.id), eq(messageReactions.emoji, emoji)))
      .returning({ id: messageReactions.id });
    if (removed.length > 0) return false;
    await tx.insert(messageReactions).values({ messageId, userId: actor.id, emoji }).onConflictDoNothing().catch(rethrowDbGuard);
    return true;
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
