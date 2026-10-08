"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getSignedIn } from "@/lib/session";
import { applyToJob, closeJob, createJob, reportJob, setApplicationStatus, unhideJob, updateJob, withdrawApplication } from "@/modules/community/jobs";
import {
  answerTeamRequest,
  closeTeamPost,
  createTeamPost,
  reportTeamPost,
  sendTeamRequest,
  unhideTeamPost,
  updateTeamPost,
  withdrawTeamRequest,
} from "@/modules/community/teams";

// Phase 33: the jobs board and the team finder.

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

async function member() {
  const me = await getSignedIn();
  if (!me) redirect("/sign-in");
  return me;
}

async function run(message: string | undefined, fn: () => Promise<unknown>, refresh: () => void): Promise<Result> {
  const result = await runAction(async () => {
    await fn();
    return undefined;
  }, message);
  if (result.ok) refresh();
  return result;
}

// --- Jobs ----------------------------------------------------------------------------------------

const jobFromForm = (form: FormData) => ({
  hirer: text(form, "hirer"),
  title: text(form, "title"),
  kind: text(form, "kind") as "JOB",
  workMode: text(form, "workMode") as "REMOTE",
  location: text(form, "location"),
  payMin: text(form, "payMin"),
  payMax: text(form, "payMax"),
  payUnit: text(form, "payUnit") as "PROJECT",
  description: text(form, "description"),
  skills: text(form, "skills"),
  closesOn: text(form, "closesOn"),
});

const refreshJobs = (id?: string) => () => {
  revalidatePath("/jobs");
  revalidatePath("/community/jobs");
  if (id) revalidatePath(`/jobs/${id}`);
};

export async function createJobAction(_prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await runAction(() => createJob(me, jobFromForm(form)));
  if (!result.ok) return result;
  refreshJobs()();
  redirect(`/jobs/${result.data}`);
}

export async function updateJobAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await run(undefined, () => updateJob(me, id, jobFromForm(form)), refreshJobs(id));
  if (!result.ok) return result;
  redirect(`/jobs/${id}`);
}

export async function closeJobAction(id: string, filled: boolean): Promise<Result> {
  const me = await member();
  return run(filled ? "Marked as filled. Congratulations!" : "Closed: no more applications.", () => closeJob(me, id, filled), refreshJobs(id));
}

export async function applyAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  return run("Application sent. You'll get an email when they answer.", () => applyToJob(me, id, { message: text(form, "message"), link: text(form, "link") }), refreshJobs(id));
}

export async function withdrawApplicationAction(id: string): Promise<Result> {
  const me = await member();
  return run("Application withdrawn.", () => withdrawApplication(me, id), refreshJobs());
}

export async function applicationStatusAction(id: string, status: "SHORTLISTED" | "HIRED" | "DECLINED"): Promise<Result> {
  const me = await member();
  const message = { SHORTLISTED: "Shortlisted. They now see your email.", HIRED: "Hired. They now see your email.", DECLINED: "Declined. They've been told kindly." }[status];
  return run(message, () => setApplicationStatus(me, id, status), refreshJobs());
}

export async function reportJobAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  return run("Thank you. The organizers will look at it.", () => reportJob(me, id, { reason: text(form, "reason") }), () => {});
}

export async function unhideJobAction(id: string): Promise<Result> {
  const me = await member();
  return run("Visible again.", () => unhideJob(me, id), refreshJobs(id));
}

// --- Team finder ---------------------------------------------------------------------------------

const teamFromForm = (form: FormData) => ({
  kind: text(form, "kind") as "IDEA",
  title: text(form, "title"),
  description: text(form, "description"),
  roles: text(form, "roles"),
  tools: text(form, "tools"),
  commitment: text(form, "commitment"),
  reward: text(form, "reward") as "LEARNING",
});

const refreshTeams = (id?: string) => () => {
  revalidatePath("/teams");
  revalidatePath("/community/teams");
  if (id) revalidatePath(`/teams/${id}`);
};

export async function createTeamPostAction(_prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await runAction(() => createTeamPost(me, teamFromForm(form)));
  if (!result.ok) return result;
  refreshTeams()();
  redirect(`/teams/${result.data}`);
}

export async function updateTeamPostAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const result = await run(undefined, () => updateTeamPost(me, id, teamFromForm(form)), refreshTeams(id));
  if (!result.ok) return result;
  redirect(`/teams/${id}`);
}

export async function closeTeamPostAction(id: string): Promise<Result> {
  const me = await member();
  return run("Closed.", () => closeTeamPost(me, id), refreshTeams(id));
}

export async function teamRequestAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  return run("Sent. You'll get an email when they answer.", () => sendTeamRequest(me, id, { message: text(form, "message") }), refreshTeams(id));
}

export async function answerTeamRequestAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const accept = text(form, "answer") === "accept";
  return run(accept ? "Accepted. You both now see each other's email." : "Declined.", () => answerTeamRequest(me, id, { accept, note: text(form, "note") }), refreshTeams());
}

export async function withdrawTeamRequestAction(id: string): Promise<Result> {
  const me = await member();
  return run("Request withdrawn.", () => withdrawTeamRequest(me, id), refreshTeams());
}

export async function reportTeamPostAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  return run("Thank you. The organizers will look at it.", () => reportTeamPost(me, id, { reason: text(form, "reason") }), () => {});
}

export async function unhideTeamPostAction(id: string): Promise<Result> {
  const me = await member();
  return run("Visible again.", () => unhideTeamPost(me, id), refreshTeams(id));
}
