"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getSignedIn } from "@/lib/session";
import { createItem, removeItem, reportItem, setFeatured, toggleUseful, unhideItem, updateItem } from "@/modules/community/library";
import { answerRequest, endMentorship, requestMentor, updateMentorSettings, withdrawRequest } from "@/modules/community/mentorship";
import { pickProjectOfMonth, previousMonth, thisMonth, voteForProject } from "@/modules/community/project-month";

// Phase 31: mentorship, the tools & prompts library, project of the month.

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

async function member() {
  const me = await getSignedIn();
  if (!me) redirect("/sign-in");
  return me;
}

// --- Mentorship --------------------------------------------------------------------------------

function refreshMentoring() {
  revalidatePath("/mentors");
  revalidatePath("/community/mentoring");
}

export async function mentorSettingsAction(_prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await updateMentorSettings(me, { open: form.get("open") === "on", capacity: text(form, "capacity"), note: text(form, "note") });
    return undefined;
  }, "Saved.");
  if (result.ok) refreshMentoring();
  return result;
}

export async function requestMentorAction(handle: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await requestMentor(me, handle, { goal: text(form, "goal") });
    return undefined;
  }, "Request sent. You'll get an email when they answer.");
  if (result.ok) refreshMentoring();
  return result;
}

export async function answerRequestAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const accept = text(form, "answer") === "accept";
  const result = await runAction(async () => {
    await answerRequest(me, id, { accept, note: text(form, "note") });
    return undefined;
  }, accept ? "Accepted. You both now see each other's email." : "Declined.");
  if (result.ok) refreshMentoring();
  return result;
}

export async function withdrawRequestAction(id: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await withdrawRequest(me, id);
    return undefined;
  }, "Request withdrawn.");
  if (result.ok) refreshMentoring();
  return result;
}

export async function endMentorshipAction(id: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await endMentorship(me, id);
    return undefined;
  }, "Mentorship ended.");
  if (result.ok) refreshMentoring();
  return result;
}

// --- Library -----------------------------------------------------------------------------------

function itemFromForm(form: FormData) {
  return {
    kind: text(form, "kind") as "TOOL",
    title: text(form, "title"),
    summary: text(form, "summary"),
    url: text(form, "url"),
    body: text(form, "body"),
    tags: text(form, "tags"),
    lowData: form.get("lowData") === "on",
    free: form.get("free") === "on",
  };
}

function refreshLibrary(id?: string) {
  revalidatePath("/library");
  if (id) revalidatePath(`/library/${id}`);
}

export async function createItemAction(_prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await runAction(() => createItem(me, itemFromForm(form)));
  if (!result.ok) return result;
  refreshLibrary();
  redirect(`/library/${result.data}`);
}

export async function updateItemAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await updateItem(me, id, itemFromForm(form));
    return undefined;
  });
  if (!result.ok) return result;
  refreshLibrary(id);
  redirect(`/library/${id}`);
}

export async function removeItemAction(id: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await removeItem(me, id);
    return undefined;
  });
  if (!result.ok) return result;
  refreshLibrary();
  redirect("/library");
}

export async function usefulAction(id: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await toggleUseful(me, id);
    return undefined;
  });
  if (result.ok) refreshLibrary(id);
  return result;
}

export async function reportItemAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  return runAction(async () => {
    await reportItem(me, id, { reason: text(form, "reason") });
    return undefined;
  }, "Thank you. The organizers will look at it.");
}

export async function featureItemAction(id: string, on: boolean): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await setFeatured(me, id, on);
    return undefined;
  }, on ? "Featured at the top of the library." : "No longer featured.");
  if (result.ok) refreshLibrary(id);
  return result;
}

export async function unhideItemAction(id: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await unhideItem(me, id);
    return undefined;
  }, "Visible again.");
  if (result.ok) refreshLibrary(id);
  return result;
}

// --- Project of the month ----------------------------------------------------------------------

export async function voteAction(postId: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    const outcome = await voteForProject(me, postId);
    return outcome;
  });
  if (!result.ok) return result;
  revalidatePath("/showcase", "layout");
  revalidatePath("/");
  const message = { voted: "Vote counted.", moved: "Your vote moved to this project.", removed: "Vote taken back." }[result.data];
  return { ok: true, data: undefined, message };
}

export async function pickProjectAction(postId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await pickProjectOfMonth(me, previousMonth(thisMonth()), postId, text(form, "note"));
    return undefined;
  }, "This is now last month's project of the month.");
  if (result.ok) {
    revalidatePath("/showcase", "layout");
    revalidatePath("/");
  }
  return result;
}
