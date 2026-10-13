import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { BUSY_NETWORK } from "./links";

// Phase 42: fake votes. Project of the month votes, "useful" marks on articles and tools & prompts
// count toward rankings, so they are worth faking. A vote is suspicious when the voter's account
// was under 3 days old when they voted, their email isn't confirmed, or they are linked to the
// author (a shared quiet network, or almost the same email). Something with at least 3 suspicious
// votes, making up at least half of its votes, is listed for staff, who can discount those votes.

export type VoteSource = "PROJECT_OF_THE_MONTH" | "ARTICLE_USEFUL" | "LIBRARY_USEFUL";

const SOURCES: Record<VoteSource, { label: string; votes: string; target: string; voter: string; items: string; author: string; title: string; link: string; scope?: string }> = {
  PROJECT_OF_THE_MONTH: {
    label: "Project of the month votes",
    votes: "project_votes",
    target: "post_id",
    voter: "voter_id",
    items: "showcase_posts",
    author: "author_id",
    title: "title",
    link: "/showcase/",
    // This month's and last month's votes (the one being settled).
    scope: "x.month >= to_char((now() AT TIME ZONE 'Africa/Accra') - interval '1 month', 'YYYY-MM')",
  },
  ARTICLE_USEFUL: { label: "Useful marks on articles", votes: "article_claps", target: "article_id", voter: "user_id", items: "articles", author: "author_id", title: "title", link: "/articles/" },
  LIBRARY_USEFUL: { label: "Useful marks on tools & prompts", votes: "library_votes", target: "item_id", voter: "voter_id", items: "library_items", author: "author_id", title: "title", link: "/library/" },
};

export const MIN_SUSPICIOUS = 3;

const base = (col: string) => `regexp_replace(split_part(split_part(lower(${col}), '@', 1), '+', 1), '[0-9._-]', '', 'g')`;

/** Each vote on a source, with whether it looks fake and why. */
function votesQuery(source: VoteSource, targetId?: string) {
  const c = SOURCES[source];
  return sql`
    WITH busy AS (SELECT ip_hash FROM login_signals GROUP BY ip_hash HAVING count(DISTINCT user_id) > ${BUSY_NETWORK})
    SELECT x.${sql.raw(c.target)} AS target_id, i.${sql.raw(c.title)} AS label, i.${sql.raw(c.author)} AS author_id, x.${sql.raw(c.voter)} AS voter_id,
      (u.created_at > x.created_at - interval '3 days') AS new_voter,
      (NOT u.email_verified) AS unconfirmed,
      (EXISTS (SELECT 1 FROM login_signals a JOIN login_signals b ON a.ip_hash = b.ip_hash
               WHERE a.user_id = i.${sql.raw(c.author)} AND b.user_id = x.${sql.raw(c.voter)} AND a.ip_hash NOT IN (SELECT ip_hash FROM busy))
       OR (length(${sql.raw(base("u.email"))}) >= 4 AND ${sql.raw(base("u.email"))} = ${sql.raw(base("au.email"))})) AS linked
    FROM ${sql.raw(c.votes)} x
    JOIN ${sql.raw(c.items)} i ON i.id = x.${sql.raw(c.target)}
    JOIN users u ON u.id = x.${sql.raw(c.voter)}
    JOIN users au ON au.id = i.${sql.raw(c.author)}
    WHERE ${sql.raw(c.scope ?? "true")} ${targetId ? sql`AND x.${sql.raw(c.target)} = ${targetId}` : sql``}`;
}

export type SuspiciousVotes = {
  source: VoteSource;
  sourceLabel: string;
  targetId: string;
  label: string;
  link: string;
  authorId: string;
  total: number;
  suspicious: number;
  reasons: { newVoters: number; unconfirmed: number; linked: number };
};

/** Things whose votes look manufactured, worst first. */
export async function suspiciousVoting(): Promise<SuspiciousVotes[]> {
  const out: SuspiciousVotes[] = [];
  for (const source of Object.keys(SOURCES) as VoteSource[]) {
    const c = SOURCES[source];
    const rows = await db.execute<{ target_id: string; label: string; author_id: string; total: number; suspicious: number; new_voters: number; unconfirmed: number; linked: number }>(sql`
      SELECT target_id, min(label) AS label, min(author_id::text) AS author_id, count(*)::int AS total,
        count(*) FILTER (WHERE new_voter OR unconfirmed OR linked)::int AS suspicious,
        count(*) FILTER (WHERE new_voter)::int AS new_voters,
        count(*) FILTER (WHERE unconfirmed)::int AS unconfirmed,
        count(*) FILTER (WHERE linked)::int AS linked
      FROM (${votesQuery(source)}) v
      GROUP BY target_id
      HAVING count(*) FILTER (WHERE new_voter OR unconfirmed OR linked) >= ${MIN_SUSPICIOUS}
         AND count(*) FILTER (WHERE new_voter OR unconfirmed OR linked) * 2 >= count(*)`);
    for (const r of rows.rows) {
      out.push({
        source,
        sourceLabel: c.label,
        targetId: r.target_id,
        label: r.label,
        link: `${c.link}${r.target_id}`,
        authorId: r.author_id,
        total: r.total,
        suspicious: r.suspicious,
        reasons: { newVoters: r.new_voters, unconfirmed: r.unconfirmed, linked: r.linked },
      });
    }
  }
  return out.sort((a, b) => b.suspicious - a.suspicious);
}

/** Removes the suspicious votes on one thing; returns how many. */
export async function removeSuspiciousVotes(source: VoteSource, targetId: string): Promise<number> {
  const c = SOURCES[source];
  const result = await db.execute(sql`
    DELETE FROM ${sql.raw(c.votes)} x
    WHERE x.${sql.raw(c.target)} = ${targetId} AND ${sql.raw(c.scope ?? "true")}
      AND x.${sql.raw(c.voter)} IN (SELECT voter_id FROM (${votesQuery(source, targetId)}) v WHERE new_voter OR unconfirmed OR linked)`);
  return result.rowCount ?? 0;
}

export const VOTE_SOURCES = Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.label])) as Record<VoteSource, string>;
