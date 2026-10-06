import { and, desc, eq, inArray } from "drizzle-orm";
import { withActor } from "@/lib/db/actor";
import { githubDeliveries, githubDeployments, githubReleases, projects, taskLinks, tasks } from "@/lib/db/schema";
import { resolveBaseUrl } from "@/lib/env";
import { githubConfig, githubRequest } from "@/lib/github/app";
import { type GithubRef, linkKey, normaliseRepo, parseGithubUrl, taskKey } from "@/lib/github/refs";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { lockProject } from "@/modules/projects";

// People's side of the GitHub integration (roadmap 2.5): connect a project to a repository,
// link GitHub items to tasks by URL, create an issue for a task, and read delivery history.

export const isGithubConfigured = () => githubConfig() !== null;

/** Managers connect a project to "owner/name"; the webhook only acts on projects connected to the event's repository. */
export async function setProjectRepo(actor: Actor, projectId: string, input: string, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const repo = normaliseRepo(input);
  if (repo === undefined) throw new ServiceError('Enter the repository as "owner/name", e.g. acme-co/payroll.');
  await withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    if (project.githubRepo === repo) return;
    await tx.update(projects).set({ githubRepo: repo }).where(eq(projects.id, projectId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: projectId,
      projectId,
      action: "project.github_repo_set",
      before: { githubRepo: project.githubRepo },
      after: { githubRepo: repo },
      request,
    });
  });
}

type Details = { title: string | null; state: string | null; authorLogin: string | null };

/** Best effort: title and state from GitHub when the app is set up; the link works without them. */
async function fetchDetails(ref: GithubRef): Promise<Details> {
  if (!isGithubConfigured() || !("number" in ref)) return { title: null, state: null, authorLogin: null };
  try {
    const path = ref.kind === "PULL_REQUEST" ? `/repos/${ref.repo}/pulls/${ref.number}` : `/repos/${ref.repo}/issues/${ref.number}`;
    const item = await githubRequest<{ title: string; state: string; draft?: boolean; merged_at?: string | null; user: { login: string } }>(ref.repo, path);
    const state = item.merged_at ? "merged" : item.draft ? "draft" : item.state;
    return { title: item.title.slice(0, 300), state, authorLogin: item.user.login };
  } catch {
    return { title: null, state: null, authorLogin: null };
  }
}

/** Managers link any task; members link their own tasks. */
export async function linkTaskUrl(actor: Actor, taskId: string, url: string, request?: RequestMeta) {
  const ref = parseGithubUrl(url);
  if (!ref) throw new ServiceError("Paste a github.com link to an issue, pull request, commit or branch.");
  const details = await fetchDetails(ref);
  return withActor(actor, async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) throw new ServiceError("Task not found.");
    assertCan(actor, "task.update", { isTaskAssignee: task.assignedTo === actor.id });
    const key = linkKey(ref);
    const [link] = await tx
      .insert(taskLinks)
      .values({
        taskId,
        projectId: task.projectId,
        kind: ref.kind,
        repo: ref.repo,
        number: "number" in ref ? ref.number : null,
        ref: "ref" in ref ? ref.ref : null,
        key,
        url: ref.url,
        ...details,
        linkedBy: actor.id,
      })
      .onConflictDoNothing()
      .returning()
      .catch(rethrowDbGuard);
    if (!link) throw new ServiceError("That GitHub item is already linked to this task.");
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: taskId,
      projectId: task.projectId,
      action: "task.github_linked",
      after: { key, url: ref.url },
      request,
    });
    return link;
  });
}

export async function unlinkTask(actor: Actor, linkId: string, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  await withActor(actor, async (tx) => {
    const [link] = await tx.delete(taskLinks).where(eq(taskLinks.id, linkId)).returning();
    if (!link) throw new ServiceError("Link not found.");
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: link.taskId,
      projectId: link.projectId,
      action: "task.github_unlinked",
      before: { key: link.key, url: link.url },
      request,
    });
  });
}

/** Creates a GitHub issue for the task in the project's repository and links it. */
export async function createIssueForTask(actor: Actor, taskId: string, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  if (!isGithubConfigured()) throw new ServiceError("The GitHub App is not set up yet (see Integrations).");
  const { task, project } = await withActor(actor, async (tx) => {
    const [row] = await tx.select({ task: tasks, project: projects }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(eq(tasks.id, taskId));
    if (!row) throw new ServiceError("Task not found.");
    return row;
  });
  if (!project.githubRepo) throw new ServiceError("Connect the project to a GitHub repository first.");
  const key = taskKey(project.code, task.number);
  let issue: { number: number; html_url: string; title: string; state: string; user: { login: string } };
  try {
    issue = await githubRequest(project.githubRepo, `/repos/${project.githubRepo}/issues`, {
      method: "POST",
      body: {
        title: `${key} ${task.title}`,
        body: [task.description, `Tracked in the AGOD Payout Tracker: ${resolveBaseUrl(process.env) ?? ""}/projects/${project.id}`, `Branch name: include \`${key}\` so the pull request links back automatically.`]
          .filter(Boolean)
          .join("\n\n"),
      },
    });
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "GitHub refused to create the issue.");
  }
  return withActor(actor, async (tx) => {
    const ref: GithubRef = { kind: "ISSUE", repo: project.githubRepo!, number: issue.number, url: issue.html_url };
    const [link] = await tx
      .insert(taskLinks)
      .values({
        taskId,
        projectId: project.id,
        kind: "ISSUE",
        repo: ref.repo,
        number: issue.number,
        key: linkKey(ref),
        url: issue.html_url,
        title: issue.title,
        state: issue.state,
        authorLogin: issue.user.login,
        linkedBy: actor.id,
      })
      .onConflictDoNothing()
      .returning();
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: taskId,
      projectId: project.id,
      action: "task.github_issue_created",
      after: { key: linkKey(ref), url: issue.html_url },
      request,
    });
    return link;
  });
}

export type TaskLink = typeof taskLinks.$inferSelect & { deployedTo: { environment: string; url: string | null; at: Date }[] };

/** Links per task for a project page, with where each merged pull request has been deployed. */
export async function getProjectGithub(actor: Actor, projectId: string) {
  return withActor(actor, async (tx) => {
    const [project] = await tx.select({ githubRepo: projects.githubRepo }).from(projects).where(eq(projects.id, projectId));
    if (!project) return null;
    const links = await tx.select().from(taskLinks).where(eq(taskLinks.projectId, projectId)).orderBy(taskLinks.createdAt);
    const shas = [...new Set(links.flatMap((l) => [l.mergeCommitSha, l.headSha]).filter((s): s is string => !!s))];
    const deployments = shas.length
      ? await tx
          .select()
          .from(githubDeployments)
          .where(and(inArray(githubDeployments.sha, shas), eq(githubDeployments.state, "success")))
          .orderBy(desc(githubDeployments.updatedAt))
      : [];
    const byTask = new Map<string, TaskLink[]>();
    for (const l of links) {
      const deployedTo = deployments
        .filter((d) => d.repo === l.repo && (d.sha === l.mergeCommitSha || d.sha === l.headSha))
        .map((d) => ({ environment: d.environment, url: d.url, at: d.updatedAt }));
      byTask.set(l.taskId, [...(byTask.get(l.taskId) ?? []), { ...l, deployedTo }]);
    }
    const repoDeployments = project.githubRepo
      ? await tx.select().from(githubDeployments).where(eq(githubDeployments.repo, project.githubRepo)).orderBy(desc(githubDeployments.updatedAt)).limit(15)
      : [];
    const releases = project.githubRepo
      ? await tx.select().from(githubReleases).where(eq(githubReleases.repo, project.githubRepo)).orderBy(desc(githubReleases.publishedAt)).limit(10)
      : [];
    const mergedPullRequests = [...byTask.values()].flat().filter((l) => l.kind === "PULL_REQUEST" && l.state === "merged");
    return { repo: project.githubRepo, byTask, mergedPullRequests, deployments: repoDeployments, releases };
  });
}

/** Admin integration page: recent webhook deliveries. */
export async function recentDeliveries(actor: Actor) {
  assertCan(actor, "audit.viewAll");
  // Deliveries are shared by every company; each sees only its own projects' repositories.
  return withActor(actor, (tx) =>
    tx
      .select()
      .from(githubDeliveries)
      .where(inArray(githubDeliveries.repo, tx.select({ repo: projects.githubRepo }).from(projects)))
      .orderBy(desc(githubDeliveries.receivedAt))
      .limit(30),
  );
}

