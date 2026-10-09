import { and, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { memberProfiles, teamPosts, teamRequests, users } from "@/lib/db/schema";
import { appUrl, sendAccountEmail } from "@/modules/accounts";
import { teamAnswerMessage, teamRequestMessage } from "@/modules/email/account";
import { ServiceError } from "@/modules/errors";
import { type Member, ensureProfile, fileReport, isOrganizer, reportInput } from "./index";
import { screen, textOf } from "@/modules/safety/screen";

// Phase 33: the team finder. A member posts an idea that needs people ("IDEA": the roles needed)
// or says they want to join a team ("JOINING": the roles they can take). Others send a short
// request (to join, or an invitation); the author accepts or declines. Accepting shares both email
// addresses, as with mentoring. Posts say how much time it takes and how people are rewarded.

export const TEAM_KINDS = { IDEA: "Looking for teammates", JOINING: "Looking for a team" } as const;
export const REWARDS = { LEARNING: "For learning and the portfolio", SHARE: "Share of what it earns", PAID: "Paid" } as const;
export type TeamKind = keyof typeof TEAM_KINDS;
export type RequestStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";

const OPEN_POSTS = 3;
const REQUESTS_PER_DAY = 10;

const list = (min: number, max: number, what: string) =>
  z
    .string()
    .max(400)
    .transform((v) => [...new Set(v.split(",").map((t) => t.trim()).filter(Boolean))])
    .refine((l) => l.length >= min, `Add at least ${min} of the ${what}`)
    .refine((l) => l.length <= max, `At most ${max} ${what}`)
    .refine((l) => l.every((t) => t.length <= 40), `Each of the ${what}: at most 40 characters`);

export const teamPostInput = z.object({
  kind: z.enum(["IDEA", "JOINING"], { error: "Say if you need teammates or want to join a team" }),
  title: z.string().trim().min(5, "Give it a title (at least 5 characters)").max(120),
  description: z.string().trim().min(20, "Say a bit more (at least 20 characters)").max(3000, "At most 3,000 characters"),
  roles: list(1, 8, "roles"),
  tools: list(0, 10, "tools"),
  commitment: z.string().trim().min(2, "Say how much time it takes, e.g. 5 hours a week").max(80),
  reward: z.enum(["LEARNING", "SHARE", "PAID"], { error: "Say how people are rewarded" }),
});

export const teamRequestInput = z.object({
  message: z.string().trim().min(10, "Say a bit about yourself (at least 10 characters)").max(1000, "At most 1,000 characters"),
});

export const teamAnswerInput = z.object({
  accept: z.boolean(),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || null),
});

async function requireConduct(member: Member) {
  const profile = await ensureProfile(member);
  if (!profile.conductAcceptedAt) throw new ServiceError("Agree to the code of conduct on the community home first.");
}

async function viewerIsOrganizer(viewer: Member | null) {
  if (!viewer) return false;
  const [p] = await db.select({ communityRole: memberProfiles.communityRole }).from(memberProfiles).where(eq(memberProfiles.userId, viewer.id));
  return isOrganizer(p ?? null, viewer.email);
}

// --- Posts -----------------------------------------------------------------------------------

export async function createTeamPost(member: Member, raw: z.input<typeof teamPostInput>): Promise<string> {
  const input = teamPostInput.parse(raw);
  await requireConduct(member);
  const [{ n }] = await db.select({ n: count() }).from(teamPosts).where(and(eq(teamPosts.authorId, member.id), eq(teamPosts.status, "OPEN")));
  if (n >= OPEN_POSTS) throw new ServiceError(`You can have ${OPEN_POSTS} open posts. Close one first.`);
  const [row] = await db
    .insert(teamPosts)
    .values({ authorId: member.id, ...input })
    .returning({ id: teamPosts.id });
  await screen(member, "TEAM", row.id, textOf(input));
  return row.id;
}

async function ownPost(member: Member, postId: string) {
  if (!z.uuid().safeParse(postId).success) throw new ServiceError("Post not found.");
  const [post] = await db.select().from(teamPosts).where(eq(teamPosts.id, postId));
  if (!post || post.authorId !== member.id) throw new ServiceError("Only the person who posted it can change it.");
  return post;
}

export async function updateTeamPost(member: Member, postId: string, raw: z.input<typeof teamPostInput>) {
  const input = teamPostInput.parse(raw);
  const post = await ownPost(member, postId);
  if (post.status !== "OPEN") throw new ServiceError("This post is closed. Post a new one instead.");
  await db.update(teamPosts).set(input).where(eq(teamPosts.id, postId));
  await screen(member, "TEAM", postId, textOf(input));
}

export async function closeTeamPost(member: Member, postId: string) {
  const post = await ownPost(member, postId);
  if (post.status !== "OPEN") throw new ServiceError("This post is already closed.");
  await db.update(teamPosts).set({ status: "CLOSED", closedAt: new Date() }).where(eq(teamPosts.id, postId));
}

export type TeamCard = {
  id: string;
  kind: TeamKind;
  title: string;
  description: string;
  roles: string[];
  tools: string[];
  commitment: string;
  reward: keyof typeof REWARDS;
  createdAt: Date;
  authorId: string;
  authorName: string;
  authorHandle: string | null;
  authorCity: string | null;
};

const cardColumns = {
  id: teamPosts.id,
  kind: teamPosts.kind,
  title: teamPosts.title,
  description: teamPosts.description,
  roles: teamPosts.roles,
  tools: teamPosts.tools,
  commitment: teamPosts.commitment,
  reward: teamPosts.reward,
  createdAt: teamPosts.createdAt,
  authorId: teamPosts.authorId,
  authorName: users.name,
  authorHandle: memberProfiles.handle,
  authorCity: memberProfiles.city,
};

const cards = () =>
  db
    .select(cardColumns)
    .from(teamPosts)
    .innerJoin(users, eq(users.id, teamPosts.authorId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, teamPosts.authorId));

const visible = () => and(eq(teamPosts.status, "OPEN"), isNull(teamPosts.hiddenAt), eq(users.active, true));

/** Open posts, newest first; filters by kind, role or tool, and words. */
export async function listTeamPosts(filters: { kind?: string; role?: string; q?: string } = {}): Promise<TeamCard[]> {
  const q = filters.q?.trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const role = filters.role?.trim().slice(0, 40);
  const rows = await cards()
    .where(
      and(
        visible(),
        filters.kind && filters.kind in TEAM_KINDS ? eq(teamPosts.kind, filters.kind) : undefined,
        role ? sql`lower(${role}) = ANY (SELECT lower(x) FROM unnest(${teamPosts.roles} || ${teamPosts.tools}) x)` : undefined,
        like
          ? or(ilike(teamPosts.title, like), ilike(teamPosts.description, like), sql`array_to_string(${teamPosts.roles} || ${teamPosts.tools}, ' ') ILIKE ${like}`)
          : undefined,
      ),
    )
    .orderBy(desc(teamPosts.createdAt))
    .limit(200);
  return rows as TeamCard[];
}

/** For the home pages: how many team posts are open. */
export async function openTeamPostCount(): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(teamPosts)
    .innerJoin(users, eq(users.id, teamPosts.authorId))
    .where(visible());
  return n;
}

export type TeamDetail = TeamCard & { status: "OPEN" | "CLOSED"; hidden: boolean; myRequest: { id: string; status: RequestStatus } | null };

/** One post. Closed posts stay readable; hidden ones only for the author and organizers. */
export async function getTeamPost(viewer: Member | null, postId: string): Promise<TeamDetail | null> {
  if (!z.uuid().safeParse(postId).success) return null;
  const [row] = await db
    .select({ ...cardColumns, status: teamPosts.status, hiddenAt: teamPosts.hiddenAt })
    .from(teamPosts)
    .innerJoin(users, eq(users.id, teamPosts.authorId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, teamPosts.authorId))
    .where(eq(teamPosts.id, postId));
  if (!row) return null;
  if (row.hiddenAt && row.authorId !== viewer?.id && !(await viewerIsOrganizer(viewer))) return null;
  const [mine] = viewer
    ? await db.select({ id: teamRequests.id, status: teamRequests.status }).from(teamRequests).where(and(eq(teamRequests.postId, postId), eq(teamRequests.fromId, viewer.id)))
    : [];
  const { hiddenAt, ...rest } = row;
  return { ...(rest as TeamCard & { status: "OPEN" | "CLOSED" }), hidden: hiddenAt !== null, myRequest: mine ? { id: mine.id, status: mine.status as RequestStatus } : null };
}

// --- Requests --------------------------------------------------------------------------------

/** Asks to join an idea, or invites someone looking for a team. A declined request can't be sent again. */
export async function sendTeamRequest(member: Member, postId: string, raw: z.input<typeof teamRequestInput>): Promise<string> {
  const input = teamRequestInput.parse(raw);
  await requireConduct(member);
  const post = await getTeamPost(member, postId);
  if (!post || post.hidden) throw new ServiceError("Post not found.");
  if (post.authorId === member.id) throw new ServiceError("This is your own post.");
  if (post.status !== "OPEN") throw new ServiceError("This post is closed.");
  const [{ n }] = await db
    .select({ n: count() })
    .from(teamRequests)
    .where(and(eq(teamRequests.fromId, member.id), gte(teamRequests.createdAt, new Date(Date.now() - 86_400_000))));
  if (n >= REQUESTS_PER_DAY) throw new ServiceError(`You can send ${REQUESTS_PER_DAY} requests a day. Try again tomorrow.`);
  const id = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(teamRequests).where(and(eq(teamRequests.postId, postId), eq(teamRequests.fromId, member.id))).for("update");
    if (existing?.status === "PENDING" || existing?.status === "ACCEPTED") throw new ServiceError("You already sent a request for this post.");
    if (existing?.status === "DECLINED") throw new ServiceError("They said no to your earlier request. Try another post.");
    if (existing) {
      await tx.update(teamRequests).set({ message: input.message, status: "PENDING", responseNote: null, respondedAt: null }).where(eq(teamRequests.id, existing.id));
      return existing.id;
    }
    const [row] = await tx.insert(teamRequests).values({ postId, fromId: member.id, message: input.message }).returning({ id: teamRequests.id });
    return row.id;
  });
  const [author] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, post.authorId));
  await sendAccountEmail(
    author.email,
    teamRequestMessage({ name: author.name, from: member.name, title: post.title, idea: post.kind === "IDEA", message: input.message, url: appUrl("/community/teams") }),
  ).catch((error) => console.error("Team request email failed", id, error instanceof Error ? error.message : error));
  return id;
}

/** The author answers. Accepting shares both email addresses. */
export async function answerTeamRequest(member: Member, requestId: string, raw: z.input<typeof teamAnswerInput>) {
  const input = teamAnswerInput.parse(raw);
  if (!z.uuid().safeParse(requestId).success) throw new ServiceError("Request not found.");
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ req: teamRequests, authorId: teamPosts.authorId, title: teamPosts.title })
      .from(teamRequests)
      .innerJoin(teamPosts, eq(teamPosts.id, teamRequests.postId))
      .where(eq(teamRequests.id, requestId))
      .for("update", { of: teamRequests });
    if (!row || row.authorId !== member.id) throw new ServiceError("Request not found.");
    if (row.req.status !== "PENDING") throw new ServiceError("This request has already been answered.");
    await tx
      .update(teamRequests)
      .set({ status: input.accept ? "ACCEPTED" : "DECLINED", responseNote: input.note, respondedAt: new Date() })
      .where(eq(teamRequests.id, requestId));
    return row;
  });
  const [from] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, result.req.fromId));
  await sendAccountEmail(
    from.email,
    teamAnswerMessage({ name: from.name, author: member.name, title: result.title, accepted: input.accept, note: input.note, authorEmail: input.accept ? member.email : null, url: appUrl("/community/teams") }),
  ).catch((error) => console.error("Team answer email failed", requestId, error instanceof Error ? error.message : error));
}

export async function withdrawTeamRequest(member: Member, requestId: string) {
  const [updated] = await db
    .update(teamRequests)
    .set({ status: "WITHDRAWN" })
    .where(and(eq(teamRequests.id, requestId), eq(teamRequests.fromId, member.id), eq(teamRequests.status, "PENDING")))
    .returning({ id: teamRequests.id });
  if (!updated) throw new ServiceError("There's no open request to withdraw.");
}

export type RequestView = {
  id: string;
  status: RequestStatus;
  message: string;
  responseNote: string | null;
  createdAt: Date;
  person: { name: string; handle: string | null; email: string | null };
};

export type MyTeams = {
  posts: (TeamCard & { status: string; hidden: boolean; requests: RequestView[] })[];
  sent: (RequestView & { post: { id: string; title: string; kind: TeamKind; open: boolean } })[];
};

/** My posts with the requests they received, and the requests I sent. Emails only once accepted. */
export async function myTeams(member: Member): Promise<MyTeams> {
  const posts = await db
    .select({ ...cardColumns, status: teamPosts.status, hiddenAt: teamPosts.hiddenAt })
    .from(teamPosts)
    .innerJoin(users, eq(users.id, teamPosts.authorId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, teamPosts.authorId))
    .where(eq(teamPosts.authorId, member.id))
    .orderBy(desc(teamPosts.createdAt))
    .limit(30);
  const person = { name: users.name, email: users.email, handle: memberProfiles.handle };
  const received = posts.length
    ? await db
        .select({ req: teamRequests, person })
        .from(teamRequests)
        .innerJoin(users, eq(users.id, teamRequests.fromId))
        .leftJoin(memberProfiles, eq(memberProfiles.userId, teamRequests.fromId))
        .where(and(inArray(teamRequests.postId, posts.map((p) => p.id)), sql`${teamRequests.status} <> 'WITHDRAWN'`))
        .orderBy(desc(teamRequests.createdAt))
    : [];
  const sent = await db
    .select({ req: teamRequests, post: teamPosts, person })
    .from(teamRequests)
    .innerJoin(teamPosts, eq(teamPosts.id, teamRequests.postId))
    .innerJoin(users, eq(users.id, teamPosts.authorId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, teamPosts.authorId))
    .where(eq(teamRequests.fromId, member.id))
    .orderBy(desc(teamRequests.createdAt))
    .limit(100);
  const view = (r: typeof teamRequests.$inferSelect, p: { name: string; email: string; handle: string | null }): RequestView => ({
    id: r.id,
    status: r.status as RequestStatus,
    message: r.message,
    responseNote: r.responseNote,
    createdAt: r.createdAt,
    person: { name: p.name, handle: p.handle, email: r.status === "ACCEPTED" ? p.email : null },
  });
  return {
    posts: posts.map(({ hiddenAt, ...p }) => ({
      ...(p as TeamCard & { status: string }),
      hidden: hiddenAt !== null,
      requests: received.filter((r) => r.req.postId === p.id).map((r) => view(r.req, r.person)),
    })),
    sent: sent.map((r) => ({
      ...view(r.req, r.person),
      post: { id: r.post.id, title: r.post.title, kind: r.post.kind as TeamKind, open: r.post.status === "OPEN" && !r.post.hiddenAt },
    })),
  };
}

// --- Moderation ------------------------------------------------------------------------------

export async function reportTeamPost(member: Member, postId: string, raw: z.input<typeof reportInput>) {
  const post = await getTeamPost(member, postId);
  if (!post) throw new ServiceError("Post not found.");
  if (post.authorId === member.id) throw new ServiceError("You can't report your own post.");
  await fileReport(member, "TEAM", postId, raw);
}

export async function unhideTeamPost(member: Member, postId: string) {
  if (!(await viewerIsOrganizer(member))) throw new ServiceError("Only community organizers can do that.");
  await db.update(teamPosts).set({ hiddenAt: null, hiddenBy: null, hiddenReason: null }).where(eq(teamPosts.id, postId));
}
