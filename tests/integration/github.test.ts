import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, notifications, taskLinks, tasks } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { PermissionError } from "@/lib/permissions";
import { ServiceError } from "@/modules/errors";
import { getProjectGithub, linkTaskUrl, setProjectRepo, unlinkTask } from "@/modules/github";
import { handleGithubDelivery } from "@/modules/github/webhook";
import { changeProjectStatus, createProject } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { createTask, updateTaskProgress } from "@/modules/tasks";
import { createUser, db, expectDbError } from "./fixtures";

vi.mock("server-only", () => ({}));

const uniq = () => crypto.randomUUID().slice(0, 8);
let delivery = 0;
const deliver = (event: string, payload: object) =>
  handleGithubDelivery({ deliveryId: `test-${uniq()}-${++delivery}`, event, payload: payload as never });

async function setup() {
  const pm = await createUser("PROJECT_MANAGER");
  const a = await createUser("TEAM_MEMBER");
  const outsider = await createUser("TEAM_MEMBER");
  const repo = `agod/app-${uniq()}`;
  const project = await createProject(pm, { name: `GH ${uniq()}`, clientType: "INTERNAL", totalValue: "1000", splitMode: "PERCENTAGE", projectOwnerId: pm.id });
  await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Dev", split: "100" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  await setProjectRepo(pm, project.id, `https://github.com/${repo.toUpperCase()}.git`);
  const t1 = await createTask(pm, project.id, { title: "Payslip API", assignedTo: a.id });
  const t2 = await createTask(pm, project.id, { title: "Docs", assignedTo: a.id });
  const key = (n: number) => `${project.code}-T${n}`;
  return { pm, a, outsider, repo, project, t1, t2, key };
}

const pr = (repo: string, number: number, extra: object) => ({
  repository: { full_name: repo },
  pull_request: {
    number,
    html_url: `https://github.com/${repo}/pull/${number}`,
    title: "Payslip API",
    body: null,
    state: "open",
    draft: false,
    merged: false,
    merged_at: null,
    merge_commit_sha: null,
    user: { login: "ama-dev" },
    head: { ref: "feature/x", sha: "a".repeat(40) },
    ...extra,
  },
});
const statusOf = async (id: string) => (await db.select({ s: tasks.status }).from(tasks).where(eq(tasks.id, id)))[0].s;

describe("task numbers and keys", () => {
  it("numbers tasks per project and normalises the repository", async () => {
    const { project, t1, t2 } = await setup();
    expect([t1.number, t2.number]).toEqual([1, 2]);
    expect(project.code).toMatch(/^AGOD-\d{4}-\d{3}$/);
  });

  it("refuses a malformed repository and lets only managers set it", async () => {
    const { pm, a, project } = await setup();
    await expect(setProjectRepo(pm, project.id, "not a repo")).rejects.toThrow(ServiceError);
    await expect(setProjectRepo(a, project.id, "agod/x")).rejects.toThrow(PermissionError);
  });
});

describe("pull request webhook", () => {
  it("links by task key, moves the task through review to QA, and records reviews and deployments", async () => {
    const { pm, a, repo, project, t1, key } = await setup();
    const head = { ref: `backend/${key(1)}-payslip-api`, sha: "b".repeat(40) };

    // Draft: not started -> in progress
    const r = await deliver("pull_request", { action: "opened", ...pr(repo, 12, { draft: true, head }) });
    expect(r.status).toBe("processed");
    expect(await statusOf(t1.id)).toBe("IN_PROGRESS");

    // Ready for review: in progress -> in review
    await deliver("pull_request", { action: "ready_for_review", ...pr(repo, 12, { head }) });
    expect(await statusOf(t1.id)).toBe("IN_REVIEW");

    // Review: changes requested notifies the assignee
    await deliver("pull_request_review", { action: "submitted", review: { state: "CHANGES_REQUESTED", user: { login: "kofi-rev" } }, ...pr(repo, 12, { head }) });
    const [link] = await db.select().from(taskLinks).where(eq(taskLinks.taskId, t1.id));
    expect(link).toMatchObject({ kind: "PULL_REQUEST", number: 12, reviewState: "changes_requested", reviewers: ["kofi-rev"], linkedBy: null });
    expect(await db.select().from(notifications).where(and(eq(notifications.recipientId, a.id), eq(notifications.type, "task.changes_requested")))).toHaveLength(1);

    // Merged: -> ready for QA, owner told to verify
    const mergeSha = "c".repeat(40);
    await deliver("pull_request", {
      action: "closed",
      ...pr(repo, 12, { head, state: "closed", merged: true, merged_at: new Date().toISOString(), merge_commit_sha: mergeSha }),
    });
    expect(await statusOf(t1.id)).toBe("READY_FOR_QA");
    expect(await db.select().from(notifications).where(and(eq(notifications.recipientId, pm.id), eq(notifications.type, "task.ready_for_qa")))).toHaveLength(1);
    const events = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, t1.id), eq(auditEvents.action, "task.progress_updated")));
    expect(events.every((e) => e.actorId === null && e.reason?.startsWith("GitHub: pull request"))).toBe(true);
    expect(events).toHaveLength(3);

    // Deployment of the merge commit shows on the link; a release is recorded
    await deliver("deployment_status", {
      repository: { full_name: repo },
      deployment: { id: Math.floor(Math.random() * 1e9), sha: mergeSha, ref: "integration", environment: "Preview – agod-workspace" },
      deployment_status: { state: "success", environment_url: "https://staging.example" },
    });
    await deliver("release", {
      action: "published",
      repository: { full_name: repo },
      release: { id: Math.floor(Math.random() * 1e9), tag_name: "v1.0.0", name: "First", html_url: `https://github.com/${repo}/releases/v1.0.0`, draft: false, published_at: new Date().toISOString() },
    });
    const gh = (await getProjectGithub(pm, project.id))!;
    expect(gh.byTask.get(t1.id)?.[0].deployedTo.map((d) => d.environment)).toEqual(["Preview – agod-workspace"]);
    expect(gh.mergedPullRequests).toHaveLength(1);
    expect(gh.releases.map((x) => x.tag)).toEqual(["v1.0.0"]);

    // PM verifies: done. A later PR event never moves a done task.
    await updateTaskProgress(pm, t1.id, { status: "DONE", completionNote: "Verified on staging", completedOn: todayInOperatingZone() });
    await deliver("pull_request", { action: "reopened", ...pr(repo, 12, { head }) });
    expect(await statusOf(t1.id)).toBe("DONE");
  });

  it("processes each delivery once and ignores other repositories", async () => {
    const { repo, t1, t2, key } = await setup();
    const payload = { action: "opened", ...pr(repo, 7, { title: `Fix ${key(2)}` }) };
    const id = `dup-${uniq()}`;
    expect((await handleGithubDelivery({ deliveryId: id, event: "pull_request", payload: payload as never })).status).toBe("processed");
    expect((await handleGithubDelivery({ deliveryId: id, event: "pull_request", payload: payload as never })).status).toBe("duplicate");
    expect(await statusOf(t2.id)).toBe("IN_REVIEW");
    expect(await db.select().from(taskLinks).where(eq(taskLinks.taskId, t2.id))).toHaveLength(1);

    await deliver("pull_request", { action: "opened", ...pr("someone/else", 3, { title: `Hijack ${key(1)}` }) });
    expect(await statusOf(t1.id)).toBe("NOT_STARTED");
    expect(await db.select().from(taskLinks).where(eq(taskLinks.taskId, t1.id))).toHaveLength(0);
  });

  it("links issues that mention a task key without changing the task", async () => {
    const { repo, t1, key } = await setup();
    await deliver("issues", {
      action: "opened",
      repository: { full_name: repo },
      issue: { number: 40, html_url: `https://github.com/${repo}/issues/40`, title: `${key(1)} Payslip API`, body: null, state: "open", user: { login: "pm" } },
    });
    const [link] = await db.select().from(taskLinks).where(eq(taskLinks.taskId, t1.id));
    expect(link).toMatchObject({ kind: "ISSUE", number: 40, state: "open" });
    expect(await statusOf(t1.id)).toBe("NOT_STARTED");
  });
});

describe("links by people", () => {
  it("assignees and managers link; only managers remove; outsiders cannot", async () => {
    const { pm, a, outsider, repo, project, t1 } = await setup();
    await expect(linkTaskUrl(a, t1.id, "https://gitlab.com/x/y/issues/1")).rejects.toThrow(ServiceError);
    const link = await linkTaskUrl(a, t1.id, `https://github.com/${repo}/pull/99`);
    expect(link).toMatchObject({ kind: "PULL_REQUEST", number: 99, linkedBy: a.id });
    await expect(linkTaskUrl(a, t1.id, `https://github.com/${repo}/pull/99/files`)).rejects.toThrow(/already linked/);
    await expect(linkTaskUrl(outsider, t1.id, `https://github.com/${repo}/pull/100`)).rejects.toThrow();
    await expectDbError(
      withActor(outsider, (tx) =>
        tx.insert(taskLinks).values({ taskId: t1.id, projectId: project.id, kind: "ISSUE", repo, number: 1, key: "x", url: "https://github.com/x", linkedBy: outsider.id }),
      ),
      /row-level security/,
    );
    await expect(unlinkTask(a, link.id)).rejects.toThrow(PermissionError);
    await unlinkTask(pm, link.id);
    expect(await db.select().from(taskLinks).where(eq(taskLinks.id, link.id))).toHaveLength(0);
  });
});

describe("webhook route", () => {
  it("needs configuration and a valid signature", async () => {
    const { POST } = await import("@/app/api/github/webhook/route");
    const body = JSON.stringify({ zen: "Keep it logically awesome.", repository: { full_name: "agod/x" } });
    const request = (signature: string | null) =>
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        body,
        headers: { "x-github-event": "ping", "x-github-delivery": `route-${uniq()}`, ...(signature ? { "x-hub-signature-256": signature } : {}) },
      });
    const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    expect((await POST(request(sign("s")))).status).toBe(503);
    vi.stubEnv("GITHUB_APP_ID", "1");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "unused-in-this-test");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "s3cret");
    try {
      expect((await POST(request(null))).status).toBe(401);
      expect((await POST(request(sign("wrong")))).status).toBe(401);
      const ok = await POST(request(sign("s3cret")));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ status: "processed", summary: "ping: nothing to do" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
