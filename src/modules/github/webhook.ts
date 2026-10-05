import { and, eq, or, sql } from "drizzle-orm";
import { type Tx, db } from "@/lib/db";
import { githubDeliveries, githubDeployments, githubReleases, notifications, projects, taskLinks, tasks } from "@/lib/db/schema";
import { findTaskKeys, taskKey } from "@/lib/github/refs";
import { recordAudit } from "@/modules/audit";
import { type TaskStatus, acceptsTaskUpdates } from "@/modules/projects/rules";
import { type PullRequestState, nextTaskStatus, pullRequestState } from "./transitions";

// GitHub webhook processing (roadmap 2.5). Runs as the system through the owner connection
// (there is no signed-in person), after the route has verified GitHub's signature. Each
// delivery is recorded once; a failure rolls the whole delivery back so GitHub can redeliver.
// Only projects whose GitHub repository matches the event's repository are touched.

type User = { login: string };
type PullRequest = {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: string;
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  user: User;
  head: { ref: string; sha: string };
};
type Payload = {
  action?: string;
  repository?: { full_name: string };
  pull_request?: PullRequest;
  review?: { state: string; user: User };
  issue?: { number: number; html_url: string; title: string; body: string | null; state: string; user: User; pull_request?: unknown };
  deployment?: { id: number; sha: string; ref: string; environment: string };
  deployment_status?: { state: string; environment_url?: string | null; target_url?: string | null };
  release?: { id: number; tag_name: string; name: string | null; html_url: string; draft: boolean; published_at: string | null };
};

export type DeliveryResult = { status: "processed" | "duplicate"; summary: string };

async function systemNotify(tx: Tx, n: { recipientId: string | null; type: string; title: string; message: string; projectId: string }) {
  if (!n.recipientId) return;
  await tx.insert(notifications).values({
    recipientId: n.recipientId,
    type: n.type,
    title: n.title,
    message: n.message,
    entityType: "project",
    entityId: n.projectId,
  });
}

/** Tasks named by key in the texts, in projects connected to this repository. */
async function tasksByKeys(tx: Tx, repo: string, texts: (string | null | undefined)[]) {
  const keys = findTaskKeys(...texts);
  if (keys.length === 0) return [];
  return tx
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(projects.githubRepo, repo),
        or(...keys.map((k) => and(eq(projects.code, k.projectCode), eq(tasks.number, k.number)))),
      ),
    );
}

/** Tasks already linked to this GitHub item (so editing a title never unlinks it). */
async function tasksByLink(tx: Tx, key: string) {
  return tx
    .select({ task: tasks, project: projects })
    .from(taskLinks)
    .innerJoin(tasks, eq(tasks.id, taskLinks.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(taskLinks.key, key));
}

type Found = Awaited<ReturnType<typeof tasksByLink>>;
const unique = (rows: Found) => [...new Map(rows.map((r) => [r.task.id, r])).values()];

async function upsertLink(tx: Tx, found: Found[number], values: Omit<typeof taskLinks.$inferInsert, "taskId" | "projectId">) {
  await tx
    .insert(taskLinks)
    .values({ ...values, taskId: found.task.id, projectId: found.project.id })
    .onConflictDoUpdate({
      target: [taskLinks.taskId, taskLinks.key],
      set: {
        title: values.title,
        state: values.state,
        url: values.url,
        authorLogin: values.authorLogin,
        headSha: values.headSha,
        mergeCommitSha: values.mergeCommitSha,
        mergedAt: values.mergedAt,
        updatedAt: new Date(),
      },
    });
}

async function moveTask(tx: Tx, found: Found[number], next: TaskStatus, pr: PullRequest, prState: PullRequestState, repo: string) {
  const { task, project } = found;
  await tx
    .update(tasks)
    .set({ status: next, ...(task.status === "BLOCKED" ? { blockedReason: null, blockedNeeds: null } : {}) })
    .where(eq(tasks.id, task.id));
  const key = taskKey(project.code, task.number);
  await recordAudit(tx, {
    actorId: null,
    entityType: "task",
    entityId: task.id,
    projectId: project.id,
    action: "task.progress_updated",
    before: { status: task.status },
    after: { status: next },
    reason: `GitHub: pull request ${repo}#${pr.number} ${prState} (${pr.html_url})`,
  });
  if (next === "READY_FOR_QA") {
    await systemNotify(tx, {
      recipientId: project.projectOwnerId,
      type: "task.ready_for_qa",
      title: `Ready for QA: ${key}`,
      message: `"${task.title}" was merged in ${repo}#${pr.number}. Verify it on staging and mark it done.`,
      projectId: project.id,
    });
  }
  return `${key} ${task.status}→${next}`;
}

async function onPullRequest(tx: Tx, repo: string, p: Payload): Promise<string> {
  const pr = p.pull_request!;
  const key = `PULL_REQUEST:${repo}#${pr.number}`;
  const prState = pullRequestState(pr);
  const found = unique([...(await tasksByKeys(tx, repo, [pr.head.ref, pr.title, pr.body])), ...(await tasksByLink(tx, key))]);
  const changes: string[] = [];
  for (const f of found) {
    await upsertLink(tx, f, {
      kind: "PULL_REQUEST",
      repo,
      number: pr.number,
      ref: pr.head.ref,
      key,
      url: pr.html_url,
      title: pr.title.slice(0, 300),
      state: prState,
      authorLogin: pr.user.login,
      headSha: pr.head.sha,
      mergeCommitSha: pr.merge_commit_sha ?? null,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      linkedBy: null,
    });
    const next = acceptsTaskUpdates(f.project.status) ? nextTaskStatus(f.task.status, prState) : null;
    if (next) changes.push(await moveTask(tx, f, next, pr, prState, repo));
  }
  if (found.length === 0) return `PR #${pr.number} ${prState}: no matching task`;
  return `PR #${pr.number} ${prState}: ${found.map((f) => taskKey(f.project.code, f.task.number)).join(", ")}${changes.length ? `; ${changes.join(", ")}` : ""}`;
}

async function onReview(tx: Tx, repo: string, p: Payload): Promise<string> {
  const pr = p.pull_request!;
  const review = p.review!;
  const state = review.state.toLowerCase();
  const key = `PULL_REQUEST:${repo}#${pr.number}`;
  const found = await tasksByLink(tx, key);
  await tx
    .update(taskLinks)
    .set({
      reviewState: state,
      reviewers: sql`(SELECT array_agg(DISTINCT r) FROM unnest(array_append(${taskLinks.reviewers}, ${review.user.login})) AS r)`,
      updatedAt: new Date(),
    })
    .where(eq(taskLinks.key, key));
  if (state === "changes_requested") {
    for (const f of found) {
      await systemNotify(tx, {
        recipientId: f.task.assignedTo,
        type: "task.changes_requested",
        title: `Changes requested on ${taskKey(f.project.code, f.task.number)}`,
        message: `${review.user.login} requested changes on ${repo}#${pr.number}.`,
        projectId: f.project.id,
      });
    }
  }
  return `Review ${state} on PR #${pr.number}: ${found.length} task(s)`;
}

async function onIssue(tx: Tx, repo: string, p: Payload): Promise<string> {
  const issue = p.issue!;
  if (issue.pull_request) return "Issue event for a pull request: ignored";
  const key = `ISSUE:${repo}#${issue.number}`;
  const found = unique([...(await tasksByKeys(tx, repo, [issue.title, issue.body])), ...(await tasksByLink(tx, key))]);
  for (const f of found) {
    await upsertLink(tx, f, {
      kind: "ISSUE",
      repo,
      number: issue.number,
      key,
      url: issue.html_url,
      title: issue.title.slice(0, 300),
      state: issue.state,
      authorLogin: issue.user.login,
      linkedBy: null,
    });
  }
  return `Issue #${issue.number} ${issue.state}: ${found.length} task(s)`;
}

async function onDeploymentStatus(tx: Tx, repo: string, p: Payload): Promise<string> {
  const d = p.deployment!;
  const status = p.deployment_status!;
  const url = status.environment_url || status.target_url || null;
  await tx
    .insert(githubDeployments)
    .values({ githubId: d.id, repo, environment: d.environment, ref: d.ref, sha: d.sha, state: status.state, url })
    .onConflictDoUpdate({ target: githubDeployments.githubId, set: { state: status.state, url, updatedAt: new Date() } });
  return `Deployment ${d.environment} ${status.state} (${d.sha.slice(0, 7)})`;
}

async function onRelease(tx: Tx, repo: string, p: Payload): Promise<string> {
  const r = p.release!;
  if (r.draft) return `Release ${r.tag_name} is a draft: ignored`;
  await tx
    .insert(githubReleases)
    .values({ githubId: r.id, repo, tag: r.tag_name, name: r.name, url: r.html_url, publishedAt: r.published_at ? new Date(r.published_at) : null })
    .onConflictDoUpdate({
      target: githubReleases.githubId,
      set: { tag: r.tag_name, name: r.name, url: r.html_url, publishedAt: r.published_at ? new Date(r.published_at) : null },
    });
  return `Release ${r.tag_name}`;
}

export async function handleGithubDelivery(input: { deliveryId: string; event: string; payload: Payload }): Promise<DeliveryResult> {
  const { deliveryId, event, payload } = input;
  const repo = payload.repository?.full_name.toLowerCase() ?? null;
  return db.transaction(async (tx) => {
    const [fresh] = await tx
      .insert(githubDeliveries)
      .values({ deliveryId, event, action: payload.action ?? null, repo, summary: "processing" })
      .onConflictDoNothing()
      .returning({ id: githubDeliveries.deliveryId });
    if (!fresh) return { status: "duplicate", summary: "Already processed" };

    let summary: string;
    if (!repo) summary = `${event}: no repository, ignored`;
    else if (event === "pull_request" && payload.pull_request) summary = await onPullRequest(tx, repo, payload);
    else if (event === "pull_request_review" && payload.pull_request && payload.review && payload.action === "submitted")
      summary = await onReview(tx, repo, payload);
    else if (event === "issues" && payload.issue) summary = await onIssue(tx, repo, payload);
    else if (event === "deployment_status" && payload.deployment && payload.deployment_status) summary = await onDeploymentStatus(tx, repo, payload);
    else if (event === "release" && payload.release) summary = await onRelease(tx, repo, payload);
    else summary = `${event}${payload.action ? `.${payload.action}` : ""}: nothing to do`;

    await tx.update(githubDeliveries).set({ summary: summary.slice(0, 1000) }).where(eq(githubDeliveries.deliveryId, deliveryId));
    return { status: "processed", summary };
  });
}

