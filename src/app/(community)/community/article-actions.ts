"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getSignedIn } from "@/lib/session";
import {
  addComment,
  createArticle,
  deleteComment,
  removeArticle,
  reportArticle,
  reportComment,
  reviewArticle,
  setCover,
  setPublished,
  toggleBookmark,
  toggleRepost,
  toggleUseful,
  unhideArticle,
  updateArticle,
} from "@/modules/community/articles";

// Phase 37: articles.

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

async function member() {
  const me = await getSignedIn();
  if (!me) redirect("/sign-in");
  return me;
}

const articleFromForm = (form: FormData) => ({ title: text(form, "title"), summary: text(form, "summary"), body: text(form, "body"), tags: text(form, "tags") });

async function fileFrom(form: FormData, key: string) {
  const file = form.get(key);
  if (!(file instanceof File) || file.size === 0) return null;
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

function refresh(id?: string) {
  revalidatePath("/articles");
  revalidatePath("/community/articles");
  if (id) revalidatePath(`/articles/${id}`);
}

/** Saves the article; "publish" in the form publishes it too. A cover picture is optional. */
async function save(me: Awaited<ReturnType<typeof member>>, form: FormData, id: string | null) {
  const articleId = id ?? (await createArticle(me, articleFromForm(form)));
  if (id) await updateArticle(me, id, articleFromForm(form));
  const cover = await fileFrom(form, "cover");
  if (cover) await setCover(me, articleId, cover);
  else if (form.get("removeCover") === "on") await setCover(me, articleId, null);
  if (text(form, "intent") === "publish") await setPublished(me, articleId, true);
  return articleId;
}

export async function createArticleAction(_prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const created = await runAction(() => createArticle(me, articleFromForm(form)));
  if (!created.ok) return created;
  const id = created.data;
  // The draft exists now; if the cover or publishing fails, the editor says why (no second draft).
  const rest = await runAction(() => save(me, form, id));
  refresh(id);
  if (!rest.ok) redirect(`/community/articles/${id}/edit?problem=${encodeURIComponent(rest.error)}`);
  redirect(text(form, "intent") === "publish" ? `/articles/${id}` : `/community/articles/${id}/edit?saved=1`);
}

export async function updateArticleAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await runAction(() => save(me, form, id));
  if (!result.ok) return result;
  refresh(id);
  if (text(form, "intent") === "publish") redirect(`/articles/${id}`);
  return { ok: true, data: undefined, message: "Saved." };
}

export async function publishAction(id: string, published: boolean): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await setPublished(me, id, published);
    return undefined;
  }, published ? "Published. Everyone can read it now." : "Back to draft. Only you can see it.");
  if (result.ok) refresh(id);
  return result;
}

export async function removeArticleAction(id: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await removeArticle(me, id);
    return undefined;
  });
  if (!result.ok) return result;
  refresh(id);
  redirect("/community/articles");
}

export async function usefulArticleAction(id: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await toggleUseful(me, id);
    return undefined;
  });
  if (result.ok) refresh(id);
  return result;
}

export async function bookmarkAction(id: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    const on = await toggleBookmark(me, id);
    return on;
  });
  if (!result.ok) return result;
  refresh(id);
  return { ok: true, data: undefined, message: result.data ? "Saved to your reading list." : "Removed from your reading list." };
}

export async function repostAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await runAction(() => toggleRepost(me, id, { note: text(form, "note") }));
  if (!result.ok) return result;
  refresh(id);
  revalidatePath("/members", "layout");
  return { ok: true, data: undefined, message: result.data ? "Reposted to your profile and the feed." : "Repost taken back." };
}

export async function commentAction(id: string, parentId: string | null, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await addComment(me, id, { body: text(form, "body") }, parentId);
    return undefined;
  });
  if (result.ok) refresh(id);
  return result;
}

export async function deleteCommentAction(articleId: string, commentId: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await deleteComment(me, commentId);
    return undefined;
  });
  if (result.ok) refresh(articleId);
  return result;
}

export async function reviewArticleAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await reviewArticle(me, id, { note: text(form, "note") });
    return undefined;
  }, "Thank you. Your review is on the article.");
  if (result.ok) refresh(id);
  return result;
}

export async function reportArticleAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  return runAction(async () => {
    await reportArticle(me, id, { reason: text(form, "reason") });
    return undefined;
  }, "Thank you. The organizers will look at it.");
}

export async function reportCommentAction(commentId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  return runAction(async () => {
    await reportComment(me, commentId, { reason: text(form, "reason") });
    return undefined;
  }, "Thank you. The organizers will look at it.");
}

export async function unhideArticleAction(id: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await unhideArticle(me, id);
    return undefined;
  }, "Visible again.");
  if (result.ok) refresh(id);
  return result;
}
