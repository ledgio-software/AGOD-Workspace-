import type { FlagTarget } from "./screen";

// Phase 41/42: the kinds of content members write, as the safety tools see them. Shared by the
// risk queue, bans and appeals so a new kind of content only needs adding here.

export type ContentKind = { table: string; id: string; author: string; label: string; link: string; kind: string };

/** Each kind of content: its table, the id and author columns, and how to name and link it (SQL over alias t). */
export const CONTENT: Record<FlagTarget, ContentKind> = {
  JOB: { table: "community_jobs", id: "id", author: "poster_id", label: "t.title", link: "'/jobs/' || t.id", kind: "Job" },
  CHAT: { table: "chat_messages", id: "id", author: "author_id", label: "left(t.body, 120)", link: "'/community/chat/' || (SELECT slug FROM chat_channels c WHERE c.id = t.channel_id) || '?thread=' || coalesce(t.parent_id, t.id)", kind: "Chat message" },
  ARTICLE: { table: "articles", id: "id", author: "author_id", label: "t.title", link: "'/articles/' || t.id", kind: "Article" },
  ARTICLE_COMMENT: { table: "article_comments", id: "id", author: "author_id", label: "left(t.body, 120)", link: "'/articles/' || t.article_id || '#comments'", kind: "Article comment" },
  POST: { table: "showcase_posts", id: "id", author: "author_id", label: "t.title", link: "'/showcase/' || t.id", kind: "Project" },
  REVIEW: { table: "showcase_reviews", id: "id", author: "reviewer_id", label: "left(t.what_works, 120)", link: "'/showcase/' || t.post_id || '#reviews'", kind: "Feedback" },
  PROFILE: { table: "member_profiles", id: "user_id", author: "user_id", label: "(SELECT name FROM users u WHERE u.id = t.user_id)", link: "'/members/' || t.handle", kind: "Profile" },
  LIBRARY: { table: "library_items", id: "id", author: "author_id", label: "t.title", link: "'/library/' || t.id", kind: "Tool or prompt" },
  TEAM: { table: "team_posts", id: "id", author: "author_id", label: "t.title", link: "'/teams/' || t.id", kind: "Team post" },
};

/** What a hidden item can be: any flagged kind, plus sessions (hidden by a ban). */
export type HideableType = FlagTarget | "SESSION";

export const HIDEABLE: Record<HideableType, ContentKind> = {
  ...CONTENT,
  SESSION: { table: "community_sessions", id: "id", author: "host_id", label: "t.title", link: "'/sessions/' || t.id", kind: "Session" },
};

export const isHideable = (type: string): type is HideableType => Object.hasOwn(HIDEABLE, type);

/** Content tables a ban cleans up. */
export const CLEANUP: { table: string; author: string }[] = Object.values(HIDEABLE).map((c) => ({ table: c.table, author: c.author }));
