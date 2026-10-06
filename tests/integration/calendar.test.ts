import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, calendarEvents, googleConnections, invoices, projectMeetings } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { authorizationUrl, newAuthRequest } from "@/lib/google/client";
import { COMPANY_SCOPES, PERSONAL_SCOPES, googleConfig } from "@/lib/google/config";
import { type Actor, PermissionError } from "@/lib/permissions";
import { createCustomer } from "@/modules/customers";
import { clearGoogleTokenCache, companyConnection, completeCompanyConnect, googleRedirectUri } from "@/modules/google";
import {
  cancelMeeting,
  companyCalendarStatus,
  completePersonalConnect,
  disconnectPersonal,
  listMeetings,
  meetingsAvailable,
  personalCalendarStatus,
  scheduleMeeting,
  syncCalendars,
  syncCompanyCalendar,
  syncPersonalCalendar,
  zonedTime,
} from "@/modules/google/calendar";
import { addInvoiceLine, createDraftInvoice, issueInvoice } from "@/modules/invoices";
import { runDailyReminders } from "@/modules/jobs/daily";
import { changeProjectStatus, createProject } from "@/modules/projects";
import { addAssignment, createMilestone } from "@/modules/projects/team";
import { createTask, updateTaskDetails, updateTaskProgress } from "@/modules/tasks";
import { type FakeGoogle, calendarSharedWith, eventsIn, fakeGoogleEnv, startFakeGoogle } from "../support/fake-google";
import { createCompany, createUser, db, expectDbError } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 24: the company calendar, personal calendars and project meetings, against a fake Google.
// Each test uses its own company, so the calendars hold only that test's data.

let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
  for (const [k, v] of Object.entries(fakeGoogleEnv(google.url))) vi.stubEnv(k, v);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await google.close();
});

beforeEach(() => {
  clearGoogleTokenCache();
  google.account.grantDrive = true;
  google.account.grantCalendar = true;
});

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const email = (u: { id: string }) => `${u.id}@agod.test`;

/** The fake consent screen as `account`, returning what the callback gets. */
async function consent(account: string, scopes: string[]) {
  google.account.email = account;
  const attempt = newAuthRequest();
  const response = await fetch(authorizationUrl(googleConfig()!, { redirectUri: googleRedirectUri(), scopes, state: attempt.state, challenge: attempt.challenge }), { redirect: "manual" });
  const back = new URL(response.headers.get("location")!);
  return { code: back.searchParams.get("code")!, verifier: attempt.verifier };
}

async function company() {
  const { org, owner: admin } = await createCompany();
  const pm = await createUser("PROJECT_MANAGER", { orgId: org.id });
  const member = await createUser("TEAM_MEMBER", { orgId: org.id });
  const helper = await createUser("TEAM_MEMBER", { orgId: org.id });
  const today = todayInOperatingZone();
  const project = await createProject(pm, {
    name: `Calendar ${randomUUID().slice(0, 6)}`,
    clientType: "INTERNAL",
    totalValue: "1000",
    splitMode: "PERCENTAGE",
    projectOwnerId: pm.id,
    targetDate: addDays(today, 30),
  });
  await addAssignment(pm, project.id, { memberId: member.id, roleOnProject: "Dev", split: "60" });
  await addAssignment(pm, project.id, { memberId: helper.id, roleOnProject: "Design", split: "40" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  const milestone = await createMilestone(pm, project.id, { title: "Beta", dueDate: addDays(today, 14) });
  const mine = await createTask(pm, project.id, { title: "Build API", assignedTo: member.id, dueDate: addDays(today, 7) });
  const theirs = await createTask(pm, project.id, { title: "Design", assignedTo: helper.id, dueDate: addDays(today, 5) });
  await createTask(pm, project.id, { title: "No date", assignedTo: member.id });
  const companyAccount = `team-${randomUUID().slice(0, 8)}@gmail.com`;
  return { org, admin, pm, member, helper, project, milestone, mine, theirs, today, companyAccount };
}

async function connectCompany(admin: Actor, account: string) {
  return completeCompanyConnect(admin, await consent(account, COMPANY_SCOPES));
}

async function companyCalendar(orgId: string) {
  const connection = (await companyConnection(orgId))!;
  return google.calendars.get(connection.calendarId!)!;
}

describe("the company calendar", () => {
  it("shows deadlines, is shared read-only with managers only, and follows changes", async () => {
    const c = await company();
    await connectCompany(c.admin, c.companyAccount);
    const customer = await createCustomer(c.pm, { name: `Cal customer ${randomUUID().slice(0, 6)}`, type: "COMPANY", status: "ACTIVE", ownerId: c.pm.id });
    const draft = await createDraftInvoice(c.pm, { customerId: customer.id });
    await addInvoiceLine(c.pm, draft.id, { description: "Setup", quantity: 1, unitPrice: "250" });
    const [current] = await db.select().from(invoices).where(eq(invoices.id, draft.id));
    const issued = await issueInvoice(c.pm, draft.id, { issueDate: c.today, dueDate: addDays(c.today, 10), version: current.version });

    const first = (await syncCompanyCalendar(c.org.id))!;
    expect(first).toMatchObject({ created: 5, updated: 0, removed: 0, failures: [] });
    const calendar = await companyCalendar(c.org.id);
    expect(calendar.owner).toBe(c.companyAccount);
    expect(calendar.summary).toBe(`${c.org.name}: projects and deadlines`);
    const titles = eventsIn(google, calendar.id).map((e) => e.summary).sort();
    expect(titles).toEqual(
      [
        `🎯 ${c.project.code} ${c.project.name}: target date`,
        `◆ ${c.project.code}: Beta`,
        `☐ ${c.project.code}-T1 Build API (TEAM_MEMBER ${c.member.id.slice(0, 6)})`,
        `☐ ${c.project.code}-T2 Design (TEAM_MEMBER ${c.helper.id.slice(0, 6)})`,
        `₵ Invoice ${issued.number} due: ${customer.name} (GHS 250.00)`,
      ].sort(),
    );
    const deadline = eventsIn(google, calendar.id).find((e) => e.summary.includes("Build API"))!;
    expect(deadline.start).toEqual({ date: addDays(c.today, 7) });
    expect(deadline.end).toEqual({ date: addDays(c.today, 8) });
    expect(deadline.description).toBe(`http://localhost:3000/projects/${c.project.id}?tab=tasks`);
    // Shared with the Admin and PM (not the company account itself), never with Team Members.
    expect(calendarSharedWith(google, calendar.id)).toEqual([email(c.admin), email(c.pm)].sort());
    expect(calendar.acl.find((r) => r.scope.value === email(c.pm))?.role).toBe("reader");

    // Nothing changed: nothing is rewritten.
    expect(await syncCompanyCalendar(c.org.id)).toMatchObject({ created: 0, updated: 0, removed: 0 });

    // A new due date updates the event; a finished task disappears.
    await updateTaskDetails(c.pm, c.mine.id, { title: "Build API", assignedTo: c.member.id, dueDate: addDays(c.today, 9), estimateHours: "" });
    await updateTaskProgress(c.helper, c.theirs.id, { status: "DONE", completionNote: "Designs done", completedOn: c.today });
    expect(await syncCompanyCalendar(c.org.id)).toMatchObject({ created: 0, updated: 1, removed: 1 });
    expect(eventsIn(google, calendar.id).find((e) => e.summary.includes("Build API"))!.start).toEqual({ date: addDays(c.today, 9) });
    expect(eventsIn(google, calendar.id).some((e) => e.summary.includes("Design"))).toBe(false);

    // An event someone deleted in Google is added again when its item next changes.
    google.calendars.get(calendar.id)!.events.delete(eventsIn(google, calendar.id).find((e) => e.summary.includes("Beta"))!.id);
    await withActor(c.pm, (tx) => tx.execute(`UPDATE milestones SET due_date = due_date + 1 WHERE id = '${c.milestone.id}'`));
    expect(await syncCompanyCalendar(c.org.id)).toMatchObject({ created: 1, updated: 0, removed: 0 });
    expect(eventsIn(google, calendar.id).some((e) => e.summary.includes("Beta"))).toBe(true);

    // A calendar deleted in Google is created again, with everything in it.
    google.calendars.delete(calendar.id);
    expect(await syncCompanyCalendar(c.org.id)).toMatchObject({ created: 4, removed: 0 });
    const again = await companyCalendar(c.org.id);
    expect(again.id).not.toBe(calendar.id);
    expect(calendarSharedWith(google, again.id)).toEqual([email(c.admin), email(c.pm)].sort());

    // A PM who leaves loses access.
    await withActor(c.admin, (tx) => tx.execute(`UPDATE memberships SET active = false WHERE user_id = '${c.pm.id}'`));
    await syncCompanyCalendar(c.org.id);
    expect(calendarSharedWith(google, again.id)).toEqual([email(c.admin)]);

    const status = (await companyCalendarStatus(c.org.id))!;
    expect(status).toMatchObject({ allowed: true, sharedWith: 1 });
    expect(status.url).toContain(encodeURIComponent(again.id));
  });

  it("is skipped when the company account didn't allow Calendar", async () => {
    const c = await company();
    google.account.grantCalendar = false;
    await connectCompany(c.admin, c.companyAccount);
    expect(await syncCompanyCalendar(c.org.id)).toBeNull();
    expect(await meetingsAvailable(c.org.id)).toBe(false);
    expect((await companyCalendarStatus(c.org.id))!.allowed).toBe(false);
    expect(google.calendars.size === 0 || [...google.calendars.values()].every((cal) => cal.owner !== c.companyAccount)).toBe(true);
  });

  it("runs every morning with the daily job", async () => {
    const c = await company();
    await connectCompany(c.admin, c.companyAccount);
    const summary = await runDailyReminders({ orgIds: [c.org.id], email: null });
    expect(summary.calendar).toMatchObject({ created: 4, updated: 0, removed: 0, failures: 0 });
    const connection = (await companyConnection(c.org.id))!;
    expect((connection.lastSync as { calendar: { created: number } }).calendar.created).toBe(4);
    // A company without Google has no calendar summary.
    const other = await createCompany();
    expect((await runDailyReminders({ orgIds: [other.org.id], email: null })).calendar).toBeUndefined();
  });
});

describe("personal calendars", () => {
  it("anyone connects their own Google account and gets a calendar of their own tasks", async () => {
    const c = await company();
    const personal = `me-${randomUUID().slice(0, 8)}@gmail.com`;
    expect(await completePersonalConnect(c.member, await consent(personal, PERSONAL_SCOPES))).toBe(personal);

    const [connection] = await db.select().from(googleConnections).where(eq(googleConnections.userId, c.member.id));
    expect(connection).toMatchObject({ kind: "PERSONAL", googleEmail: personal, scopes: expect.stringContaining("calendar.app.created") });
    const calendar = google.calendars.get(connection.calendarId!)!;
    expect(calendar.owner).toBe(personal);
    expect(calendar.summary).toBe(`${c.org.name}: my tasks`);
    // Only their own dated task (not the helper's, not the undated one, no deadlines of the company).
    expect(eventsIn(google, calendar.id).map((e) => e.summary)).toEqual([`☐ ${c.project.code}-T1 Build API`]);
    expect(calendarSharedWith(google, calendar.id)).toEqual([]);

    const status = (await personalCalendarStatus(c.member))!;
    expect(status.googleEmail).toBe(personal);
    expect(status.lastSyncAt).toBeTruthy();
    expect(await personalCalendarStatus(c.helper)).toBeNull();

    // Reassigned to someone else: it leaves their calendar.
    await updateTaskDetails(c.pm, c.mine.id, { title: "Build API", assignedTo: c.helper.id, dueDate: addDays(c.today, 7), estimateHours: "" });
    expect(await syncPersonalCalendar(c.org.id, c.member.id)).toMatchObject({ removed: 1 });
    expect(eventsIn(google, calendar.id)).toHaveLength(0);

    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.entityId, connection.id));
    expect(audit.action).toBe("google.personal_connected");

    // Disconnecting revokes the sign-in; the daily job then leaves it alone.
    await disconnectPersonal(c.member);
    expect(await personalCalendarStatus(c.member)).toBeNull();
    expect([...google.refreshTokens.values()].filter((t) => t.email === personal).every((t) => t.revoked)).toBe(true);
    await expect(disconnectPersonal(c.member)).rejects.toThrow(/not connected/);
  });

  it("refuses a connection without Calendar access", async () => {
    const c = await company();
    google.account.grantCalendar = false;
    await expect(completePersonalConnect(c.member, await consent(`no-${randomUUID().slice(0, 6)}@gmail.com`, PERSONAL_SCOPES))).rejects.toThrow(/Calendar access/);
    expect(await personalCalendarStatus(c.member)).toBeNull();
  });

  it("shares the company calendar with a manager's own Google account once they connect it", async () => {
    const c = await company();
    await connectCompany(c.admin, c.companyAccount);
    await syncCompanyCalendar(c.org.id);
    const personal = `pm-${randomUUID().slice(0, 8)}@gmail.com`;
    await completePersonalConnect(c.pm, await consent(personal, PERSONAL_SCOPES));
    await syncCompanyCalendar(c.org.id);
    const calendar = await companyCalendar(c.org.id);
    expect(calendarSharedWith(google, calendar.id)).toEqual([email(c.admin), personal].sort());
    // The daily job keeps both kinds of calendars.
    const totals = (await syncCalendars(c.org.id))!;
    expect(totals.failures).toEqual([]);
  });
});

describe("project meetings", () => {
  const input = (today: string) => ({ title: "Sprint review", agenda: "Demo the API", date: addDays(today, 2), time: "14:30", durationMinutes: 45 });

  it("managers schedule a meeting with a Meet link; Google invites the project team", async () => {
    const c = await company();
    expect(await meetingsAvailable(c.org.id)).toBe(false);
    await expect(scheduleMeeting(c.pm, c.project.id, input(c.today))).rejects.toThrow(/isn't connected/);
    await connectCompany(c.admin, c.companyAccount);
    expect(await meetingsAvailable(c.org.id)).toBe(true);
    await expect(scheduleMeeting(c.member, c.project.id, input(c.today))).rejects.toThrow(PermissionError);

    // The helper connected their own Google account: their invitation goes there.
    const helperGoogle = `helper-${randomUUID().slice(0, 8)}@gmail.com`;
    await completePersonalConnect(c.helper, await consent(helperGoogle, PERSONAL_SCOPES));

    const meeting = await scheduleMeeting(c.pm, c.project.id, input(c.today));
    expect(meeting.meetUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    expect(meeting.startsAt.toISOString()).toBe(zonedTime(addDays(c.today, 2), "14:30").toISOString());
    expect(meeting.endsAt.getTime() - meeting.startsAt.getTime()).toBe(45 * 60_000);
    const calendar = await companyCalendar(c.org.id);
    const event = calendar.events.get(meeting.googleEventId!)!;
    expect(event.summary).toBe(`${c.project.code}: Sprint review`);
    expect(event.description).toContain("Demo the API");
    expect(event.start.timeZone).toBe("Africa/Accra");
    expect(event.hangoutLink).toBe(meeting.meetUrl);
    // Owner, assigned member and task assignees (the helper at their own Google address).
    expect([...event.attendees].sort()).toEqual([email(c.pm), email(c.member), helperGoogle].sort());
    expect([...event.notified].sort()).toEqual([email(c.pm), email(c.member), helperGoogle].map((a) => `invite:${a}`).sort());

    // Everyone on the project sees it; another company doesn't.
    expect((await listMeetings(c.member, c.project.id)).map((m) => m.meeting.id)).toEqual([meeting.id]);
    const other = await createCompany();
    expect(await listMeetings(other.owner, c.project.id)).toEqual([]);

    // Calendar sync leaves meetings alone.
    await syncCompanyCalendar(c.org.id);
    expect(calendar.events.has(meeting.googleEventId!)).toBe(true);

    await expect(cancelMeeting(c.member, meeting.id)).rejects.toThrow(PermissionError);
    await cancelMeeting(c.pm, meeting.id);
    expect(calendar.events.has(meeting.googleEventId!)).toBe(false);
    expect(google.deletedEvents.find((e) => e.id === meeting.googleEventId)!.notified).toEqual(expect.arrayContaining([`cancel:${email(c.member)}`]));
    expect(await listMeetings(c.pm, c.project.id)).toEqual([]);
    await expect(cancelMeeting(c.pm, meeting.id)).rejects.toThrow(/not found/);
    const actions = (await db.select().from(auditEvents).where(eq(auditEvents.entityId, meeting.id))).map((a) => a.action).sort();
    expect(actions).toEqual(["meeting.cancelled", "meeting.scheduled"]);
  });

  it("checks the time and keeps nothing when Google refuses", async () => {
    const c = await company();
    await connectCompany(c.admin, c.companyAccount);
    await expect(scheduleMeeting(c.pm, c.project.id, { ...input(c.today), date: addDays(c.today, -1) })).rejects.toThrow(/future/);
    await expect(scheduleMeeting(c.pm, c.project.id, { ...input(c.today), time: "25:00" })).rejects.toThrow(/start time/);
    await expect(scheduleMeeting(c.pm, c.project.id, { ...input(c.today), durationMinutes: 600 })).rejects.toThrow(/8 hours/);
    google.revokeAll();
    clearGoogleTokenCache();
    await expect(scheduleMeeting(c.pm, c.project.id, input(c.today))).rejects.toThrow();
    expect(await db.select().from(projectMeetings).where(eq(projectMeetings.projectId, c.project.id))).toHaveLength(0);
  });

  it("guards meetings in the database", async () => {
    const c = await company();
    await connectCompany(c.admin, c.companyAccount);
    const meeting = await scheduleMeeting(c.pm, c.project.id, input(c.today));
    await expectDbError(withActor(c.pm, (tx) => tx.update(projectMeetings).set({ title: "Changed" }).where(eq(projectMeetings.id, meeting.id))), /can only be cancelled/);
    await expectDbError(withActor(c.pm, (tx) => tx.delete(projectMeetings).where(eq(projectMeetings.id, meeting.id))), /permission denied|cancelled, not deleted/);
    // Team Members can't write them directly either.
    const changed = await withActor(c.member, (tx) => tx.update(projectMeetings).set({ meetUrl: "https://example.com" }).where(eq(projectMeetings.id, meeting.id)).returning());
    expect(changed).toHaveLength(0);
    await expectDbError(
      withActor(c.member, (tx) => tx.insert(projectMeetings).values({ projectId: c.project.id, title: "Mine", startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000), createdBy: c.member.id })),
      /row-level security/,
    );
    // Calendar mappings are server-only.
    await expectDbError(withActor(c.admin, (tx) => tx.select().from(calendarEvents)), /permission denied/);
  });
});

describe("times", () => {
  it("reads a local date and time in the operating time zone", () => {
    expect(zonedTime("2026-10-08", "14:30", "Africa/Accra").toISOString()).toBe("2026-10-08T14:30:00.000Z");
    expect(zonedTime("2026-10-08", "14:30", "Europe/London").toISOString()).toBe("2026-10-08T13:30:00.000Z");
    expect(zonedTime("2026-01-08", "09:00", "America/New_York").toISOString()).toBe("2026-01-08T14:00:00.000Z");
  });
});
