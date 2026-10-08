import { and, asc, count, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chatChannels, chatMessages, chatReactions, chatReads, memberProfiles, users } from "@/lib/db/schema";
import { ServiceError } from "@/modules/errors";
import { REACTIONS } from "@/modules/messages/catalog";
import { type Member, canModerate, ensureProfile, fileReport, reportInput } from "./index";

// Phase 36: community chat, like Discord channels. Everyone signed in reads and talks in topic
// channels (after agreeing to the code of conduct). A message can start a thread of replies; in the
// questions channel each message is a question its author (or an organizer) marks solved. People
// are tagged with @handle. Open pages ask every few seconds whether anything changed, and fetch
// only when it did, to keep data use low.

const PAGE = 60;
const PER_MINUTE = 20;
export const CHAT_REACTIONS = REACTIONS;

export type Channel = { id: string; slug: string; name: string; description: string; kind: "CHAT" | "QUESTIONS"; unread: number; mentions: number };

export type ChatMessage = {
  id: string;
  authorId: string;
  authorName: string;
  authorHandle: string | null;
  body: string;
  createdAt: string;
  replyCount: number;
  lastReplyAt: string | null;
  solved: boolean;
  mentionsMe: boolean;
  mine: boolean;
  removed: boolean;
  reactions: { emoji: string; count: number; mine: boolean; names: string[] }[];
};

async function requireConduct(member: Member) {
  const profile = await ensureProfile(member);
  if (!profile.conductAcceptedAt) throw new ServiceError("Agree to the code of conduct on the community home first.");
}

async function channelBySlug(slug: string) {
  if (!/^[a-z0-9-]{1,30}$/.test(slug)) return null;
  const [c] = await db.select().from(chatChannels).where(and(eq(chatChannels.slug, slug), isNull(chatChannels.archivedAt)));
  return c ?? null;
}

/** The channels, with how many new messages and @mentions I haven't seen in each. */
export async function listChannels(member: Member): Promise<Channel[]> {
  const rows = await db.execute<{ id: string; slug: string; name: string; description: string; kind: "CHAT" | "QUESTIONS"; unread: number; mentions: number }>(sql`
    select c.id, c.slug, c.name, c.description, c.kind,
      (select count(*)::int from chat_messages m
        where m.channel_id = c.id and m.author_id <> ${member.id} and m.removed_at is null and m.hidden_at is null
          and m.created_at > coalesce(r.last_read_at, now() - interval '7 days')) as unread,
      (select count(*)::int from chat_messages m
        where m.channel_id = c.id and ${member.id}::uuid = any(m.mentioned_ids) and m.removed_at is null and m.hidden_at is null
          and m.created_at > coalesce(r.last_read_at, 'epoch'::timestamptz)) as mentions
    from chat_channels c
    left join chat_reads r on r.channel_id = c.id and r.user_id = ${member.id}
    where c.archived_at is null
    order by c.position, c.name`);
  return rows.rows;
}

/** Total unread @mentions, for the community menu. */
export async function unreadMentions(member: Member): Promise<number> {
  return (await listChannels(member)).reduce((n, c) => n + c.mentions, 0);
}

/** Changes whenever anything in the channel (or one thread) changes: open pages compare it before fetching. */
async function version(channelId: string, parentId: string | null): Promise<string> {
  const [row] = await db
    .select({ at: sql<string>`coalesce(max(${chatMessages.updatedAt})::text, '')`, n: count() })
    .from(chatMessages)
    .where(and(eq(chatMessages.channelId, channelId), parentId ? sql`(${chatMessages.id} = ${parentId} or ${chatMessages.parentId} = ${parentId})` : undefined));
  return `${row.at}|${row.n}`;
}

async function toMessages(member: Member, rows: (typeof chatMessages.$inferSelect & { authorName: string; authorHandle: string | null })[], organizer: boolean): Promise<ChatMessage[]> {
  const ids = rows.map((r) => r.id);
  const reactions = ids.length
    ? await db
        .select({ messageId: chatReactions.messageId, userId: chatReactions.userId, emoji: chatReactions.emoji, name: users.name })
        .from(chatReactions)
        .innerJoin(users, eq(users.id, chatReactions.userId))
        .where(inArray(chatReactions.messageId, ids))
        .orderBy(asc(chatReactions.createdAt))
    : [];
  return rows.map((r) => {
    const gone = !!r.removedAt || (!!r.hiddenAt && !organizer);
    const byEmoji = new Map<string, ChatMessage["reactions"][number]>();
    if (!gone) {
      for (const x of reactions.filter((x) => x.messageId === r.id)) {
        const e = byEmoji.get(x.emoji) ?? { emoji: x.emoji, count: 0, mine: false, names: [] };
        e.count++;
        e.mine ||= x.userId === member.id;
        e.names.push(x.userId === member.id ? "You" : x.name);
        byEmoji.set(x.emoji, e);
      }
    }
    return {
      id: r.id,
      authorId: r.authorId,
      authorName: r.authorName,
      authorHandle: r.authorHandle,
      body: r.removedAt ? "This message was deleted." : r.hiddenAt && !organizer ? "This message was hidden by the organizers." : r.body,
      createdAt: r.createdAt.toISOString(),
      replyCount: r.replyCount,
      lastReplyAt: r.lastReplyAt?.toISOString() ?? null,
      solved: r.solvedAt !== null,
      mentionsMe: r.mentionedIds.includes(member.id),
      mine: r.authorId === member.id,
      removed: gone,
      reactions: [...byEmoji.values()],
    };
  });
}

const withAuthor = () =>
  db
    .select({ m: chatMessages, authorName: users.name, authorHandle: memberProfiles.handle })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.authorId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, chatMessages.authorId));

export type ChannelView = { channel: Omit<Channel, "unread" | "mentions">; messages: ChatMessage[]; version: string; hasMore: boolean };

/** A channel's latest messages (oldest first), and marks it read. With `known`, returns null when nothing changed. */
export async function openChannel(member: Member, slug: string, opts: { known?: string; before?: string } = {}): Promise<ChannelView | null | "unchanged"> {
  const channel = await channelBySlug(slug);
  if (!channel) return null;
  const v = await version(channel.id, null);
  if (opts.known && opts.known === v && !opts.before) return "unchanged";
  const before = opts.before ? new Date(opts.before) : null;
  const rows = await withAuthor()
    .where(and(eq(chatMessages.channelId, channel.id), isNull(chatMessages.parentId), before && !Number.isNaN(before.getTime()) ? lt(chatMessages.createdAt, before) : undefined))
    .orderBy(desc(chatMessages.createdAt))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE).reverse();
  if (!before) {
    await db
      .insert(chatReads)
      .values({ userId: member.id, channelId: channel.id, lastReadAt: new Date() })
      .onConflictDoUpdate({ target: [chatReads.userId, chatReads.channelId], set: { lastReadAt: new Date() } });
  }
  const organizer = await canModerate(member);
  return {
    channel: { id: channel.id, slug: channel.slug, name: channel.name, description: channel.description, kind: channel.kind as Channel["kind"] },
    messages: await toMessages(member, page.map((r) => ({ ...r.m, authorName: r.authorName, authorHandle: r.authorHandle })), organizer),
    version: v,
    hasMore: rows.length > PAGE,
  };
}

export type ThreadView = { parent: ChatMessage; replies: ChatMessage[]; channelSlug: string; channelKind: Channel["kind"]; version: string };

/** A thread: the message that started it and its replies (oldest first). */
export async function openThread(member: Member, messageId: string, known?: string): Promise<ThreadView | null | "unchanged"> {
  if (!z.uuid().safeParse(messageId).success) return null;
  const [parent] = await withAuthor().where(and(eq(chatMessages.id, messageId), isNull(chatMessages.parentId)));
  if (!parent) return null;
  const [channel] = await db.select().from(chatChannels).where(eq(chatChannels.id, parent.m.channelId));
  const v = await version(channel.id, messageId);
  if (known && known === v) return "unchanged";
  const replies = await withAuthor().where(eq(chatMessages.parentId, messageId)).orderBy(asc(chatMessages.createdAt)).limit(300);
  const organizer = await canModerate(member);
  const [p, ...rs] = await toMessages(member, [parent, ...replies].map((r) => ({ ...r.m, authorName: r.authorName, authorHandle: r.authorHandle })), organizer);
  return { parent: p, replies: rs, channelSlug: channel.slug, channelKind: channel.kind as Channel["kind"], version: v };
}

export const postInput = z.object({ body: z.string().trim().min(1, "Write a message").max(2000, "Keep a message under 2,000 characters") });

/** @handle tags that belong to members (at most 10). */
async function mentionsIn(body: string, except: string): Promise<string[]> {
  const handles = [...new Set([...body.matchAll(/(?:^|[^\w@])@([a-z0-9][a-z0-9-]{1,39})/gi)].map((m) => m[1].toLowerCase()))].slice(0, 10);
  if (handles.length === 0) return [];
  const rows = await db
    .select({ id: memberProfiles.userId })
    .from(memberProfiles)
    .innerJoin(users, eq(users.id, memberProfiles.userId))
    .where(and(inArray(sql`lower(${memberProfiles.handle})`, handles), eq(users.active, true)));
  return rows.map((r) => r.id).filter((id) => id !== except);
}

/** Posts in a channel, or replies in a thread (parentId). */
export async function postMessage(member: Member, slug: string, raw: z.input<typeof postInput>, parentId?: string | null): Promise<string> {
  const { body } = postInput.parse(raw);
  await requireConduct(member);
  const channel = await channelBySlug(slug);
  if (!channel) throw new ServiceError("Channel not found.");
  const [{ n }] = await db
    .select({ n: count() })
    .from(chatMessages)
    .where(and(eq(chatMessages.authorId, member.id), gte(chatMessages.createdAt, new Date(Date.now() - 60_000))));
  if (n >= PER_MINUTE) throw new ServiceError("You're sending messages very fast. Wait a minute and try again.");
  const mentionedIds = await mentionsIn(body, member.id);
  return db.transaction(async (tx) => {
    const now = new Date();
    if (parentId) {
      if (!z.uuid().safeParse(parentId).success) throw new ServiceError("Message not found.");
      const [parent] = await tx
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.id, parentId), eq(chatMessages.channelId, channel.id), isNull(chatMessages.parentId)))
        .for("update");
      if (!parent || parent.removedAt || parent.hiddenAt) throw new ServiceError("That message isn't there any more.");
      await tx
        .update(chatMessages)
        .set({ replyCount: sql`${chatMessages.replyCount} + 1`, lastReplyAt: now, updatedAt: now })
        .where(eq(chatMessages.id, parentId));
    }
    const [row] = await tx
      .insert(chatMessages)
      .values({ channelId: channel.id, authorId: member.id, parentId: parentId ?? null, body, mentionedIds, createdAt: now, updatedAt: now })
      .returning({ id: chatMessages.id });
    await tx
      .insert(chatReads)
      .values({ userId: member.id, channelId: channel.id, lastReadAt: now })
      .onConflictDoUpdate({ target: [chatReads.userId, chatReads.channelId], set: { lastReadAt: now } });
    return row.id;
  });
}

async function loadMessage(messageId: string) {
  if (!z.uuid().safeParse(messageId).success) throw new ServiceError("Message not found.");
  const [m] = await db.select().from(chatMessages).where(eq(chatMessages.id, messageId));
  if (!m) throw new ServiceError("Message not found.");
  return m;
}

/** Adds my reaction, or takes it back. */
export async function reactToMessage(member: Member, messageId: string, emoji: string): Promise<boolean> {
  if (!(CHAT_REACTIONS as readonly string[]).includes(emoji)) throw new ServiceError("Choose one of the reactions.");
  await requireConduct(member);
  const m = await loadMessage(messageId);
  if (m.removedAt || m.hiddenAt) throw new ServiceError("That message isn't there any more.");
  const removed = await db
    .delete(chatReactions)
    .where(and(eq(chatReactions.messageId, messageId), eq(chatReactions.userId, member.id), eq(chatReactions.emoji, emoji)))
    .returning({ id: chatReactions.id });
  if (removed.length === 0) await db.insert(chatReactions).values({ messageId, userId: member.id, emoji }).onConflictDoNothing();
  await db.update(chatMessages).set({ updatedAt: new Date() }).where(eq(chatMessages.id, messageId));
  return removed.length === 0;
}

/** Questions channel: the asker (or an organizer) marks a question solved, or not solved again. */
export async function setSolved(member: Member, messageId: string, solved: boolean) {
  const m = await loadMessage(messageId);
  const [channel] = await db.select({ kind: chatChannels.kind }).from(chatChannels).where(eq(chatChannels.id, m.channelId));
  if (channel?.kind !== "QUESTIONS" || m.parentId) throw new ServiceError("Only questions can be marked solved.");
  if (m.authorId !== member.id && !(await canModerate(member))) throw new ServiceError("Only the person who asked can mark it solved.");
  await db
    .update(chatMessages)
    .set(solved ? { solvedAt: new Date(), solvedBy: member.id, updatedAt: new Date() } : { solvedAt: null, solvedBy: null, updatedAt: new Date() })
    .where(eq(chatMessages.id, messageId));
}

/** The author deletes their own message (it shows as deleted; its thread stays). */
export async function deleteMessage(member: Member, messageId: string) {
  const m = await loadMessage(messageId);
  if (m.authorId !== member.id) throw new ServiceError("You can only delete your own messages.");
  await db.update(chatMessages).set({ removedAt: new Date(), updatedAt: new Date() }).where(and(eq(chatMessages.id, messageId), isNull(chatMessages.removedAt)));
}

export async function reportMessage(member: Member, messageId: string, raw: z.input<typeof reportInput>) {
  const m = await loadMessage(messageId);
  if (m.authorId === member.id) throw new ServiceError("You can't report your own message.");
  if (m.removedAt) throw new ServiceError("That message was deleted.");
  await fileReport(member, "CHAT", messageId, raw);
}

/** Organizers: hide a message straight away (or show it again). */
export async function setHidden(member: Member, messageId: string, hidden: boolean, reason = "Hidden by an organizer") {
  if (!(await canModerate(member))) throw new ServiceError("Only community organizers can do that.");
  const m = await loadMessage(messageId);
  if (hidden && m.authorId === member.id) throw new ServiceError("Delete your own message instead.");
  await db
    .update(chatMessages)
    .set(hidden ? { hiddenAt: new Date(), hiddenBy: member.id, hiddenReason: reason, updatedAt: new Date() } : { hiddenAt: null, hiddenBy: null, hiddenReason: null, updatedAt: new Date() })
    .where(eq(chatMessages.id, messageId));
}

/** People to suggest after "@": recent voices in the channel, then anyone matching. */
export async function mentionSuggestions(member: Member, query: string): Promise<{ handle: string; name: string }[]> {
  const q = query.trim().toLowerCase().slice(0, 30);
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .select({ handle: memberProfiles.handle, name: users.name })
    .from(memberProfiles)
    .innerJoin(users, eq(users.id, memberProfiles.userId))
    .where(and(eq(users.active, true), isNull(memberProfiles.hiddenAt), sql`${memberProfiles.userId} <> ${member.id}`, q ? sql`(${memberProfiles.handle} ILIKE ${like} OR ${users.name} ILIKE ${like})` : undefined))
    .orderBy(asc(users.name))
    .limit(8);
  return rows;
}
