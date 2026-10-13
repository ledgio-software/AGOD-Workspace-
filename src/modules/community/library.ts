import { and, count, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { libraryItems, libraryVotes, memberProfiles, users } from "@/lib/db/schema";
import { ServiceError } from "@/modules/errors";
import { type Member, ensureProfile, fileReport, isOrganizer, reportInput } from "./index";
import { screen, textOf } from "@/modules/safety/screen";

// Phase 31: the tools & prompts library. Members share tools (with a link), prompts that worked
// (the text to copy) and guides; others mark them "useful". Organizers feature the best and hide
// what's reported. Everything is public, so visitors can learn too.

export const LIBRARY_KINDS = { TOOL: "Tool", PROMPT: "Prompt", GUIDE: "Guide" } as const;
export type LibraryKind = keyof typeof LIBRARY_KINDS;
const PER_DAY = 10;

const link = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : /^https?:\/\//i.test(v) ? v.replace(/^http:\/\//i, "https://") : `https://${v}`))
  .refine((v) => v === null || /^https:\/\/[^\s/]+\.[^\s]+$/.test(v), "Enter a web address such as https://tool.com");

export const itemInput = z
  .object({
    kind: z.enum(["TOOL", "PROMPT", "GUIDE"]),
    title: z.string().trim().min(3, "Give it a name (at least 3 characters)").max(120),
    summary: z.string().trim().min(10, "Say what it's good for (at least 10 characters)").max(300, "What it's good for: at most 300 characters"),
    url: link,
    body: z
      .string()
      .trim()
      .max(4000, "The prompt: at most 4,000 characters")
      .transform((v) => v || null),
    tags: z
      .string()
      .max(300)
      .transform((v) => [...new Set(v.split(",").map((t) => t.trim()).filter(Boolean))])
      .refine((l) => l.length <= 8, "At most 8 tags")
      .refine((l) => l.every((t) => t.length <= 30), "Each tag at most 30 characters"),
    lowData: z.boolean(),
    free: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "PROMPT" && !v.body) ctx.addIssue({ code: "custom", path: ["body"], message: "Paste the prompt" });
    if (v.kind !== "PROMPT" && !v.url) ctx.addIssue({ code: "custom", path: ["url"], message: "Add the link" });
  });

async function requireConduct(member: Member) {
  const profile = await ensureProfile(member);
  if (!profile.conductAcceptedAt) throw new ServiceError("Agree to the code of conduct on the community home first.");
  return profile;
}

async function viewerIsOrganizer(viewer: Member | null) {
  if (!viewer) return false;
  const [p] = await db.select({ communityRole: memberProfiles.communityRole }).from(memberProfiles).where(eq(memberProfiles.userId, viewer.id));
  return isOrganizer(p ?? null, viewer.email);
}

export async function createItem(member: Member, raw: z.input<typeof itemInput>): Promise<string> {
  const input = itemInput.parse(raw);
  await requireConduct(member);
  const [{ n }] = await db
    .select({ n: count() })
    .from(libraryItems)
    .where(and(eq(libraryItems.authorId, member.id), gte(libraryItems.createdAt, new Date(Date.now() - 86_400_000))));
  if (n >= PER_DAY) throw new ServiceError(`You can add ${PER_DAY} items a day. Thank you for sharing so much: try again tomorrow.`);
  const [row] = await db
    .insert(libraryItems)
    .values({ authorId: member.id, ...input })
    .returning({ id: libraryItems.id });
  await screen(member, "LIBRARY", row.id, textOf(input));
  return row.id;
}

export async function updateItem(member: Member, itemId: string, raw: z.input<typeof itemInput>) {
  const input = itemInput.parse(raw);
  const [item] = await db.select().from(libraryItems).where(and(eq(libraryItems.id, itemId), isNull(libraryItems.removedAt)));
  if (!item || item.authorId !== member.id) throw new ServiceError("Only the person who shared it can change it.");
  await db.update(libraryItems).set(input).where(eq(libraryItems.id, itemId));
  await screen(member, "LIBRARY", itemId, textOf(input));
}

export async function removeItem(member: Member, itemId: string) {
  const [updated] = await db
    .update(libraryItems)
    .set({ removedAt: new Date() })
    .where(and(eq(libraryItems.id, itemId), eq(libraryItems.authorId, member.id), isNull(libraryItems.removedAt)))
    .returning({ id: libraryItems.id });
  if (!updated) throw new ServiceError("Only the person who shared it can remove it.");
}

/** Marks an item useful, or takes the mark back. Not your own. Returns whether it's now marked. */
export async function toggleUseful(member: Member, itemId: string): Promise<boolean> {
  await requireConduct(member);
  const [item] = await db.select({ authorId: libraryItems.authorId }).from(libraryItems).where(and(eq(libraryItems.id, itemId), isNull(libraryItems.removedAt), isNull(libraryItems.hiddenAt)));
  if (!item) throw new ServiceError("Item not found.");
  if (item.authorId === member.id) throw new ServiceError("You can't mark your own item.");
  const deleted = await db.delete(libraryVotes).where(and(eq(libraryVotes.itemId, itemId), eq(libraryVotes.voterId, member.id))).returning({ itemId: libraryVotes.itemId });
  if (deleted.length > 0) return false;
  await db.insert(libraryVotes).values({ itemId, voterId: member.id }).onConflictDoNothing();
  return true;
}

export type LibraryItem = {
  id: string;
  kind: LibraryKind;
  title: string;
  summary: string;
  url: string | null;
  body: string | null;
  tags: string[];
  lowData: boolean;
  free: boolean;
  featured: boolean;
  createdAt: Date;
  authorId: string;
  authorName: string;
  authorHandle: string | null;
  useful: number;
  markedByMe: boolean;
  hidden: boolean;
};

const useful = sql<number>`(select count(*)::int from library_votes v where v.item_id = ${libraryItems.id})`;

function select(viewer: Member | null) {
  return db
    .select({
      id: libraryItems.id,
      kind: libraryItems.kind,
      title: libraryItems.title,
      summary: libraryItems.summary,
      url: libraryItems.url,
      body: libraryItems.body,
      tags: libraryItems.tags,
      lowData: libraryItems.lowData,
      free: libraryItems.free,
      featuredAt: libraryItems.featuredAt,
      hiddenAt: libraryItems.hiddenAt,
      createdAt: libraryItems.createdAt,
      authorId: libraryItems.authorId,
      authorName: users.name,
      authorHandle: memberProfiles.handle,
      useful,
      markedByMe: viewer
        ? sql<boolean>`exists (select 1 from library_votes v where v.item_id = ${libraryItems.id} and v.voter_id = ${viewer.id})`
        : sql<boolean>`false`,
    })
    .from(libraryItems)
    .innerJoin(users, eq(users.id, libraryItems.authorId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, libraryItems.authorId));
}

type Row = Awaited<ReturnType<ReturnType<typeof select>["execute"]>>[number];
const toItem = (r: Row): LibraryItem => ({
  ...r,
  kind: r.kind as LibraryKind,
  featured: r.featuredAt !== null,
  hidden: r.hiddenAt !== null,
});

export async function listItems(
  viewer: Member | null,
  filters: { kind?: string; tag?: string; q?: string; sort?: string; lowData?: boolean } = {},
): Promise<LibraryItem[]> {
  const q = filters.q?.trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const kind = filters.kind && filters.kind in LIBRARY_KINDS ? filters.kind : null;
  const tag = filters.tag?.trim().slice(0, 30);
  const rows = await select(viewer)
    .where(
      and(
        isNull(libraryItems.removedAt),
        isNull(libraryItems.hiddenAt),
        kind ? eq(libraryItems.kind, kind) : undefined,
        tag ? sql`lower(${tag}) = ANY (SELECT lower(x) FROM unnest(${libraryItems.tags}) x)` : undefined,
        filters.lowData ? eq(libraryItems.lowData, true) : undefined,
        like ? or(ilike(libraryItems.title, like), ilike(libraryItems.summary, like), ilike(libraryItems.body, like), sql`array_to_string(${libraryItems.tags}, ' ') ILIKE ${like}`) : undefined,
      ),
    )
    .orderBy(...(filters.sort === "new" ? [desc(libraryItems.createdAt)] : [sql`${libraryItems.featuredAt} IS NULL`, desc(useful), desc(libraryItems.createdAt)]))
    .limit(200);
  return rows.map(toItem);
}

/** One item; hidden ones only for organizers and the author. */
export async function getItem(viewer: Member | null, itemId: string): Promise<LibraryItem | null> {
  if (!z.uuid().safeParse(itemId).success) return null;
  const [row] = await select(viewer).where(and(eq(libraryItems.id, itemId), isNull(libraryItems.removedAt)));
  if (!row) return null;
  if (row.hiddenAt && row.authorId !== viewer?.id && !(await viewerIsOrganizer(viewer))) return null;
  return toItem(row);
}

/** Popular tags, for the filter. */
export async function libraryTags(): Promise<string[]> {
  const rows = await db.execute<{ tag: string }>(sql`
    SELECT min(t) AS tag FROM library_items i, unnest(i.tags) t
    WHERE i.removed_at IS NULL AND i.hidden_at IS NULL
    GROUP BY lower(t) ORDER BY count(*) DESC, lower(t) LIMIT 20`);
  return rows.rows.map((r) => r.tag);
}

export async function reportItem(member: Member, itemId: string, raw: z.input<typeof reportInput>) {
  const item = await getItem(member, itemId);
  if (!item) throw new ServiceError("Item not found.");
  if (item.authorId === member.id) throw new ServiceError("You can't report your own item.");
  await fileReport(member, "LIBRARY", itemId, raw);
}

async function requireOrganizer(member: Member) {
  if (!(await viewerIsOrganizer(member))) throw new ServiceError("Only community organizers can do that.");
}

/** Organizers: feature an item at the top of the library, or stop featuring it. */
export async function setFeatured(member: Member, itemId: string, on: boolean) {
  await requireOrganizer(member);
  const [updated] = await db
    .update(libraryItems)
    .set(on ? { featuredAt: new Date(), featuredBy: member.id } : { featuredAt: null, featuredBy: null })
    .where(and(eq(libraryItems.id, itemId), isNull(libraryItems.removedAt)))
    .returning({ id: libraryItems.id });
  if (!updated) throw new ServiceError("Item not found.");
}

/** Organizers: shows a hidden item again. */
export async function unhideItem(member: Member, itemId: string) {
  await requireOrganizer(member);
  await db.update(libraryItems).set({ hiddenAt: null, hiddenBy: null, hiddenReason: null }).where(eq(libraryItems.id, itemId));
}
