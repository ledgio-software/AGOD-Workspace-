"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { COMPANY_COOKIE, companiesOf, getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { acceptConduct, reportProfile, resolveReport, setOrganizer, unhideProfile, updateProfile } from "@/modules/community";
import {
  type PostStatus,
  addReview,
  addScreenshot,
  createPost,
  removePost,
  removeScreenshot,
  replyToReview,
  reportPost,
  reportReview,
  setPostStatus,
  unhideShowcase,
  updatePost,
} from "@/modules/community/showcase";
import {
  addRecording,
  cancelSession,
  createSession,
  joinSession,
  leaveSession,
  reportSession,
  unhideSession,
  updateSession,
} from "@/modules/community/sessions";
import { ServiceError } from "@/modules/errors";
import { teamTypeInput } from "@/modules/roles";
import { createOrganization } from "@/modules/orgs";

// Phase 25: community actions. Any signed-in person may use them (company or not); the module
// checks organizer rights itself.

async function member() {
  const user = await getSignedIn();
  if (!user) redirect("/sign-in");
  return user;
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function refreshCommunity() {
  revalidatePath("/community", "layout");
  revalidatePath("/members", "layout");
  revalidatePath("/");
}

export async function acceptConductAction(): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => { await acceptConduct(me); return undefined; }, "Thank you. Welcome to the community!");
  refreshCommunity();
  return result;
}

export async function updateProfileAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await updateProfile(me, {
      handle: text(form, "handle"),
      headline: text(form, "headline"),
      bio: text(form, "bio"),
      city: text(form, "city"),
      tools: text(form, "tools"),
      websiteUrl: text(form, "websiteUrl"),
      githubUrl: text(form, "githubUrl"),
      linkedinUrl: text(form, "linkedinUrl"),
      xUrl: text(form, "xUrl"),
      reviewer: form.get("reviewer") === "on",
      wantsMentor: form.get("wantsMentor") === "on",
      visibility: text(form, "visibility") === "MEMBERS" ? "MEMBERS" : "PUBLIC",
    });
    return undefined;
  }, "Profile saved.");
  if (result.ok) refreshCommunity();
  return result;
}

export async function reportProfileAction(handle: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  return runAction(async () => {
    await reportProfile(me, handle, { reason: text(form, "reason") });
    return undefined;
  }, "Thank you. The organizers will look at it.");
}

export async function resolveReportAction(reportId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  const action = text(form, "action") === "HIDE" ? "HIDE" : "DISMISS";
  const result = await runAction(async () => {
    await resolveReport(me, reportId, { action, note: text(form, "note") });
    return undefined;
  }, action === "HIDE" ? "Profile hidden and report closed." : "Report dismissed.");
  if (result.ok) refreshCommunity();
  return result;
}

export async function unhideProfileAction(handle: string): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => { await unhideProfile(me, handle); return undefined; }, "The profile is visible again.");
  if (result.ok) refreshCommunity();
  return result;
}

export async function setOrganizerAction(handle: string, on: boolean): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => { await setOrganizer(me, handle, on); return undefined; }, on ? "They are now an organizer." : "They are a builder again.");
  if (result.ok) refreshCommunity();
  return result;
}

/** A member without a company creates one (while sign-up is open) and opens it. */
export async function createCompanyAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  let orgId = "";
  const result = await runAction(async () => {
    if (!signupOpen()) throw new ServiceError("Creating new companies is closed right now.");
    if ((await companiesOf(me.id)).length > 0) throw new ServiceError("You already belong to a company.");
    const teamType = teamTypeInput.catch("OTHER").parse(text(form, "teamType"));
    orgId = (await createOrganization({ name: text(form, "name"), ownerId: me.id, teamType })).id;
    return undefined;
  });
  if (!result.ok) return result;
  (await cookies()).set(COMPANY_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

// --- Phase 26: the showcase -------------------------------------------------------------------

function postFromForm(form: FormData) {
  return {
    title: text(form, "title"),
    pitch: text(form, "pitch"),
    audience: text(form, "audience"),
    builtWith: text(form, "builtWith"),
    aiBuilt: form.get("aiBuilt") === "on",
    liveUrl: text(form, "liveUrl"),
    repoUrl: text(form, "repoUrl"),
    videoUrl: text(form, "videoUrl"),
    feedbackAreas: form.getAll("feedbackAreas").map(String),
    feedbackWanted: text(form, "feedbackWanted"),
    stuckOn: text(form, "stuckOn"),
    needs: form.getAll("needs").map(String),
    visibility: (text(form, "visibility") === "MEMBERS" ? "MEMBERS" : "PUBLIC") as "PUBLIC" | "MEMBERS",
    safety: (["noSecrets", "loginProtected", "noPersonalData"].every((k) => form.get(k) === "on") ? true : false) as true,
  };
}

async function fileFrom(form: FormData, key: string) {
  const file = form.get(key);
  if (!(file instanceof File) || file.size === 0) return null;
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

function refreshShowcase(postId?: string) {
  revalidatePath("/showcase");
  if (postId) revalidatePath(`/showcase/${postId}`);
  refreshCommunity();
}

export async function createPostAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  let postId = "";
  let screenshotError: string | null = null;
  const result = await runAction(async () => {
    postId = (await createPost(me, postFromForm(form))).id;
    const shot = await fileFrom(form, "screenshot");
    if (shot) {
      // The post is kept even when the screenshot is refused; the author can add one on the post.
      await addScreenshot(me, postId, shot).catch((error) => {
        screenshotError = error instanceof ServiceError ? error.message : "The screenshot couldn't be saved.";
      });
    }
    return undefined;
  });
  if (!result.ok) return result;
  refreshShowcase(postId);
  redirect(`/showcase/${postId}${screenshotError ? "?screenshot=failed" : "?posted=1"}`);
}

export async function updatePostAction(postId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await updatePost(me, postId, postFromForm(form));
    return undefined;
  });
  if (!result.ok) return result;
  refreshShowcase(postId);
  redirect(`/showcase/${postId}`);
}

export async function setPostStatusAction(postId: string, status: PostStatus): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await setPostStatus(me, postId, status);
    return undefined;
  }, status === "SHIPPED" ? "Marked as shipped. Congratulations!" : "Status updated.");
  if (result.ok) refreshShowcase(postId);
  return result;
}

export async function removePostAction(postId: string): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await removePost(me, postId);
    return undefined;
  });
  if (!result.ok) return result;
  refreshShowcase(postId);
  redirect("/showcase");
}

export async function addScreenshotAction(postId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    const shot = await fileFrom(form, "screenshot");
    if (!shot) throw new ServiceError("Choose an image.");
    await addScreenshot(me, postId, shot);
    return undefined;
  }, "Screenshot added.");
  if (result.ok) refreshShowcase(postId);
  return result;
}

export async function removeScreenshotAction(postId: string, imageId: string): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await removeScreenshot(me, imageId);
    return undefined;
  }, "Screenshot removed.");
  if (result.ok) refreshShowcase(postId);
  return result;
}

export async function addReviewAction(postId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await addReview(me, postId, { whatWorks: text(form, "whatWorks"), toImprove: text(form, "toImprove"), nextStep: text(form, "nextStep") });
    return undefined;
  }, "Thank you for giving back! The builder has been told.");
  if (result.ok) refreshShowcase(postId);
  return result;
}

export async function replyToReviewAction(postId: string, reviewId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await replyToReview(me, reviewId, { reply: text(form, "reply") });
    return undefined;
  }, "Reply posted.");
  if (result.ok) refreshShowcase(postId);
  return result;
}

export async function reportPostAction(postId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  return runAction(async () => {
    await reportPost(me, postId, { reason: text(form, "reason") });
    return undefined;
  }, "Thank you. The organizers will look at it.");
}

export async function reportReviewAction(reviewId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  return runAction(async () => {
    await reportReview(me, reviewId, { reason: text(form, "reason") });
    return undefined;
  }, "Thank you. The organizers will look at it.");
}

export async function unhideShowcaseAction(postId: string, targetType: "POST" | "REVIEW", id: string): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await unhideShowcase(me, targetType, id);
    return undefined;
  }, "Visible again.");
  if (result.ok) refreshShowcase(postId);
  return result;
}

// --- Phase 27: teaching sessions --------------------------------------------------------------

function sessionFromForm(form: FormData) {
  return {
    title: text(form, "title"),
    description: text(form, "description"),
    level: (["BEGINNER", "INTERMEDIATE"].includes(text(form, "level")) ? text(form, "level") : "ALL") as "BEGINNER" | "INTERMEDIATE" | "ALL",
    topics: text(form, "topics"),
    date: text(form, "date"),
    time: text(form, "time"),
    durationMinutes: Number(text(form, "durationMinutes")),
    callUrl: text(form, "callUrl"),
    capacity: text(form, "capacity"),
  };
}

function refreshSessions(sessionId?: string) {
  revalidatePath("/sessions");
  if (sessionId) revalidatePath(`/sessions/${sessionId}`);
  refreshCommunity();
}

export async function createSessionAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  let sessionId = "";
  const result = await runAction(async () => {
    sessionId = (await createSession(me, sessionFromForm(form))).id;
    return undefined;
  });
  if (!result.ok) return result;
  refreshSessions(sessionId);
  redirect(`/sessions/${sessionId}?scheduled=1`);
}

export async function updateSessionAction(sessionId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await updateSession(me, sessionId, sessionFromForm(form));
    return undefined;
  });
  if (!result.ok) return result;
  refreshSessions(sessionId);
  redirect(`/sessions/${sessionId}`);
}

export async function cancelSessionAction(sessionId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await cancelSession(me, sessionId, { reason: text(form, "reason") });
    return undefined;
  }, "Session cancelled. Everyone who joined was told.");
  if (result.ok) refreshSessions(sessionId);
  return result;
}

export async function joinSessionAction(sessionId: string): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await joinSession(me, sessionId);
    return undefined;
  }, "You're in! Check your email for the calendar invite.");
  if (result.ok) refreshSessions(sessionId);
  return result;
}

export async function leaveSessionAction(sessionId: string): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await leaveSession(me, sessionId);
    return undefined;
  }, "You left the session.");
  if (result.ok) refreshSessions(sessionId);
  return result;
}

export async function addRecordingAction(sessionId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await addRecording(me, sessionId, { recordingUrl: text(form, "recordingUrl"), notes: text(form, "notes") });
    return undefined;
  }, "Saved. Thank you for teaching!");
  if (result.ok) refreshSessions(sessionId);
  return result;
}

export async function reportSessionAction(sessionId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  return runAction(async () => {
    await reportSession(me, sessionId, { reason: text(form, "reason") });
    return undefined;
  }, "Thank you. The organizers will look at it.");
}

export async function unhideSessionAction(sessionId: string): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await unhideSession(me, sessionId);
    return undefined;
  }, "Visible again.");
  if (result.ok) refreshSessions(sessionId);
  return result;
}
