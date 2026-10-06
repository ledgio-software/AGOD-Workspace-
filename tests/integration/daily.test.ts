import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { jobRuns, notificationPreferences, notifications } from "@/lib/db/schema";
import { PermissionError } from "@/lib/permissions";
import { runDailyReminders, recentJobRuns } from "@/modules/jobs/daily";
import { getDailyEmail, setDailyEmail } from "@/modules/notifications/preferences";
import { changeProjectStatus, createProject } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { createTask } from "@/modules/tasks";
import { createUser, db } from "./fixtures";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function memberWithTaskDueTomorrow() {
  const pm = await createUser("PROJECT_MANAGER");
  const member = await createUser("TEAM_MEMBER");
  const project = await createProject(pm, { name: `Daily ${crypto.randomUUID().slice(0, 6)}`, clientType: "INTERNAL", totalValue: "1000", splitMode: "PERCENTAGE", projectOwnerId: pm.id });
  await addAssignment(pm, project.id, { memberId: member.id, roleOnProject: "Dev", split: "70" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  await createTask(pm, project.id, { title: "Ship the login page", assignedTo: member.id, dueDate: day(1) });
  return { pm, member };
}

async function outbox() {
  const dir = await mkdtemp(path.join(tmpdir(), "agod-mail-"));
  const read = async () =>
    Promise.all((await readdir(dir)).map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as { to: string; subject: string; text: string }));
  return { config: { provider: "outbox" as const, dir, from: "AGOD <agod@test>" }, read };
}

describe("daily reminders job", () => {
  it("creates reminders, emails each new notification once, and records the run", async () => {
    const { pm, member } = await memberWithTaskDueTomorrow();
    const mail = await outbox();

    const first = await runDailyReminders({ email: mail.config, userIds: [pm.id, member.id] });
    expect(first.remindersCreated).toBeGreaterThanOrEqual(1);
    const sent = await mail.read();
    const toMember = sent.filter((m) => m.to.startsWith(member.id));
    expect(toMember).toHaveLength(1);
    // The assignment notification and the due-soon reminder arrive together.
    expect(toMember[0].text).toContain("Ship the login page");
    expect(toMember[0].text).toMatch(/Due (today|soon)/);

    // Running again sends nothing new: each notification is emailed at most once.
    const second = await runDailyReminders({ email: mail.config, userIds: [pm.id, member.id] });
    expect(second.emailsSent).toBe(0);
    expect((await mail.read()).filter((m) => m.to.startsWith(member.id))).toHaveLength(1);

    const [run] = await db.select().from(jobRuns).orderBy(jobRuns.startedAt).limit(1).offset(0);
    expect(run).toBeDefined();
  });

  it("skips people who turned the email off, and read notifications", async () => {
    const { pm, member } = await memberWithTaskDueTomorrow();
    const mail = await outbox();
    await setDailyEmail(member, false);
    expect(await getDailyEmail(member)).toBe(false);
    // The PM reads everything before the run.
    await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.recipientId, pm.id));

    const summary = await runDailyReminders({ email: mail.config, userIds: [pm.id, member.id] });
    expect(summary.emailsSkipped).toBe(1);
    expect((await mail.read()).filter((m) => m.to.startsWith(member.id))).toHaveLength(0);
  });

  it("keeps notifications for the next run when sending fails", async () => {
    const { member } = await memberWithTaskDueTomorrow();
    // An outbox path under a file can't be created, so sending fails.
    const broken = { provider: "outbox" as const, dir: "/dev/null/agod", from: "x" };
    const summary = await runDailyReminders({ email: broken, userIds: [member.id] });
    expect(summary.emailFailures).toBe(1);
    const pending = await db.select().from(notifications).where(and(eq(notifications.recipientId, member.id)));
    expect(pending.every((n) => n.emailedAt === null)).toBe(true);
    const mail = await outbox();
    expect((await runDailyReminders({ email: mail.config, userIds: [member.id] })).emailsSent).toBe(1);
  });

  it("with email off it still creates reminders", async () => {
    const { member } = await memberWithTaskDueTomorrow();
    const summary = await runDailyReminders({ email: null, userIds: [member.id] });
    expect(summary.email).toBe("off");
    expect(summary.remindersCreated).toBeGreaterThanOrEqual(1);
  });

  it("only Admins see the runs; each person sees only their own email choice", async () => {
    const admin = await createUser("ADMIN");
    const pm = await createUser("PROJECT_MANAGER");
    await runDailyReminders({ email: null, userIds: [admin.id] });
    expect((await recentJobRuns(admin)).length).toBeGreaterThan(0);
    await expect(recentJobRuns(pm)).rejects.toThrow(PermissionError);
    expect(await withActor(pm, (tx) => tx.select().from(jobRuns))).toHaveLength(0);

    await setDailyEmail(admin, false);
    expect(await withActor(pm, (tx) => tx.select().from(notificationPreferences).where(eq(notificationPreferences.userId, admin.id)))).toHaveLength(0);
    expect(await getDailyEmail(pm)).toBe(true); // default
  });
});
