import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, notifications, organizations, releases, users } from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions";
import { addAssignment } from "@/modules/projects/team";
import { createOrganization, setReleaseControl } from "@/modules/orgs";
import { createProject } from "@/modules/projects";
import {
  createRelease,
  decideRelease,
  getRelease,
  listProjectReleases,
  markDeployed,
  markRolledBack,
  releaseEvidenceCsv,
  releaseOverview,
  releasesWaitingCount,
  securityReview,
  submitRelease,
  updateDraft,
  withdrawRelease,
} from "@/modules/releases";
import { applyTeamType } from "@/modules/roles";
import { createCompany, createUser, db, expectDbError } from "./fixtures";

// Phase 32: release approvals (change control), the security check, the emergency path and the
// evidence export.

/** A company with release approvals on (two people for money: on), a project with one developer. */
async function company() {
  const { org, owner } = await createCompany();
  const pm = await createUser("PROJECT_MANAGER", { orgId: org.id });
  const pm2 = await createUser("PROJECT_MANAGER", { orgId: org.id });
  const dev = await createUser("TEAM_MEMBER", { orgId: org.id });
  const outsider = await createUser("TEAM_MEMBER", { orgId: org.id });
  await setReleaseControl(owner, { on: true, reason: "Our bank client asks for change control" });
  const project = await createProject(pm, {
    name: `Wallet ${randomUUID().slice(0, 6)}`,
    clientType: "INTERNAL",
    totalValue: "1000",
    splitMode: "PERCENTAGE",
    projectOwnerId: pm.id,
  });
  await addAssignment(pm, project.id, { memberId: dev.id, roleOnProject: "Backend developer", split: "100" });
  return { org, owner, pm, pm2, dev, outsider, project };
}

const release = (extra: Record<string, unknown> = {}) => ({
  title: "Mobile money refunds",
  versionLabel: "v2.4.0",
  changeSummary: "Customers can get refunds to their MoMo wallet.",
  reason: "Customers asked for it",
  securityImpact: "LOW" as const,
  testEvidence: "Unit tests and a sandbox refund",
  rollbackPlan: "Redeploy v2.3.1",
  emergency: false,
  ...extra,
});

const statusOf = async (id: string) => (await db.select({ s: releases.status }).from(releases).where(eq(releases.id, id)))[0].s;
const notified = async (recipient: Actor, type: string) =>
  (await db.select().from(notifications).where(and(eq(notifications.recipientId, recipient.id), eq(notifications.type, type)))).length;

describe("switching release approvals on", () => {
  it("off by default; on for fintech teams; every change is audited", async () => {
    const { org, owner } = await createCompany();
    const pm = await createUser("PROJECT_MANAGER", { orgId: org.id });
    const project = await createProject(pm, { name: "Site", clientType: "INTERNAL", totalValue: "10", splitMode: "PERCENTAGE", projectOwnerId: pm.id });
    await expect(createRelease(pm, project.id, release())).rejects.toThrow(/switched off/);
    await expect(setReleaseControl(pm, { on: true, reason: "Please" })).rejects.toThrow(/Not allowed/);
    await setReleaseControl(owner, { on: true, reason: "Bank client" });
    const [event] = await db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, org.id), eq(auditEvents.action, "company.release_control_changed")));
    expect(event).toMatchObject({ reason: "Bank client", afterJson: { releaseControl: true } });
    expect(await createRelease(pm, project.id, release())).toBeTruthy();

    const ownerId = randomUUID();
    await db.insert(users).values({ id: ownerId, name: "Founder", email: `${ownerId}@agod.test` });
    const fintech = await createOrganization({ name: `Pay ${ownerId.slice(0, 6)}`, ownerId, teamType: "FINTECH" });
    expect(fintech.releaseControl).toBe(true);

    const other = await createCompany();
    await applyTeamType(other.owner, "FINTECH");
    const [row] = await db.select({ on: organizations.releaseControl }).from(organizations).where(eq(organizations.id, other.org.id));
    expect(row.on).toBe(true);
  });
});

describe("a release from draft to deployed", () => {
  it("someone else checks security, a manager approves, someone else deploys", async () => {
    const { pm, pm2, dev, outsider, project } = await company();
    await expect(createRelease(outsider, project.id, release())).rejects.toThrow(/Project not found/);
    const id = await createRelease(dev, project.id, release({ securityImpact: "HIGH" }));
    expect(await getRelease(outsider, id)).toBeNull();
    await updateDraft(dev, id, release({ securityImpact: "HIGH", title: "MoMo refunds" }));
    await submitRelease(dev, id);
    expect(await notified(pm, "release.submitted")).toBe(1);
    expect(await releasesWaitingCount(pm)).toBe(1);
    expect((await releaseOverview(pm)).waiting.map((r) => r.id)).toEqual([id]);
    await expect(updateDraft(dev, id, release())).rejects.toThrow(/can't be edited/);

    // High impact: no approval before the security check, and the author can't do the check.
    await expect(decideRelease(pm2, id, { approve: true, note: "" })).rejects.toThrow(/security check before approval/);
    await expect(securityReview(dev, id, { note: "Looks safe to me" })).rejects.toThrow(/someone else must do the security check/);
    expect((await getRelease(dev, id))!.can).toMatchObject({ securityCheck: false, decide: false, deploy: false });
    await securityReview(pm, id, { note: "Amounts come from the server; permissions checked" });
    await expect(withdrawRelease(dev, id)).rejects.toThrow(/security check is already done/);
    await decideRelease(pm2, id, { approve: true, note: "Go" });
    expect(await statusOf(id)).toBe("APPROVED");
    expect(await notified(dev, "release.approved")).toBe(1);

    // The author doesn't deploy their own release.
    await expect(markDeployed(dev, id, { note: "" })).rejects.toThrow(/someone else must deploy/);
    await markDeployed(pm, id, { note: "Deployed at 18:00" });
    await expect(markRolledBack(dev, id, { note: "" })).rejects.toThrow(/at least 3/);
    await markRolledBack(dev, id, { note: "Refunds failed for one bank" });
    expect(await statusOf(id)).toBe("ROLLED_BACK");

    const detail = (await getRelease(pm, id))!;
    expect(detail.people).toMatchObject({ author: { id: dev.id }, securityReviewedBy: { id: pm.id }, decidedBy: { id: pm2.id }, deployedBy: { id: pm.id }, rolledBackBy: { id: dev.id } });
    expect((await listProjectReleases(dev, project.id)).map((r) => [r.title, r.status])).toEqual([["MoMo refunds", "ROLLED_BACK"]]);
    const actions = await db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, id));
    expect(actions.map((a) => a.action).sort()).toEqual(
      ["release.approved", "release.created", "release.deployed", "release.rolled_back", "release.security_checked", "release.submitted", "release.updated"].sort(),
    );
  });

  it("a manager can't approve their own release; rejecting needs a reason; take back before the check", async () => {
    const { pm, pm2, dev, project } = await company();
    const id = await createRelease(pm, project.id, release());
    await submitRelease(pm, id);
    expect(await releasesWaitingCount(pm)).toBe(0);
    await expect(decideRelease(pm, id, { approve: true, note: "" })).rejects.toThrow(/another manager must approve/);
    await expect(decideRelease(dev, id, { approve: true, note: "" })).rejects.toThrow(/Not allowed/);
    await withdrawRelease(pm, id);
    expect(await statusOf(id)).toBe("DRAFT");
    await submitRelease(pm, id);
    await expect(decideRelease(pm2, id, { approve: false, note: "" })).rejects.toThrow(/Say why/);
    await decideRelease(pm2, id, { approve: false, note: "No rollback test" });
    expect(await statusOf(id)).toBe("REJECTED");
    await expect(markDeployed(dev, id, { note: "" })).rejects.toThrow(/approved release/);
  });
});

describe("emergency releases", () => {
  it("can go live before approval (with a reason, by someone else) and are approved afterwards", async () => {
    const { pm, pm2, dev, project } = await company();
    const normal = await createRelease(dev, project.id, release());
    await submitRelease(dev, normal);
    await expect(markDeployed(pm, normal, { note: "Now" })).rejects.toThrow(/approved release \(or an emergency one\)/);

    const id = await createRelease(dev, project.id, release({ title: "Fix double charges", emergency: true }));
    await submitRelease(dev, id);
    await expect(markDeployed(pm, id, { note: "" })).rejects.toThrow(/can't wait/);
    await expect(markDeployed(dev, id, { note: "Customers charged twice" })).rejects.toThrow(/someone else must deploy/);
    await markDeployed(pm, id, { note: "Customers are being charged twice" });
    expect(await statusOf(id)).toBe("DEPLOYED");
    expect(await notified(pm2, "release.deployed_emergency")).toBe(1);
    expect((await releaseOverview(pm2)).waiting.map((r) => r.id)).toContain(id);

    await decideRelease(pm2, id, { approve: true, note: "Agreed, it was urgent" });
    const [row] = await db.select().from(releases).where(eq(releases.id, id));
    expect(row).toMatchObject({ status: "DEPLOYED", decision: "APPROVED", decidedBy: pm2.id });
    expect((await releaseOverview(pm2)).waiting.map((r) => r.id)).not.toContain(id);
  });
});

describe("the database keeps the rules", () => {
  it("order of steps, no edits after submitting, not the author, managers decide", async () => {
    const { pm, pm2, dev, project } = await company();
    const id = await createRelease(dev, project.id, release({ securityImpact: "HIGH" }));
    const raw = (actor: Actor, set: ReturnType<typeof sql>) => withActor(actor, (tx) => tx.execute(sql`update releases set ${set} where id = ${id}`));
    await expectDbError(raw(pm, sql`status = 'APPROVED'`), /can't go from DRAFT to APPROVED/);
    await expectDbError(
      withActor(dev, (tx) => tx.insert(releases).values({ projectId: project.id, createdBy: dev.id, status: "APPROVED", ...release() })),
      /row-level security/,
    );
    await submitRelease(dev, id);
    await expectDbError(raw(dev, sql`title = 'Sneaky change'`), /can't be edited/);
    await expectDbError(raw(dev, sql`security_reviewed_by = ${dev.id}, security_reviewed_at = now()`), /someone other than the author/i);
    await expectDbError(raw(dev, sql`status = 'APPROVED', decision = 'APPROVED', decided_by = ${pm.id}, decided_at = now()`), /Only managers/);
    await expectDbError(raw(pm, sql`status = 'APPROVED', decision = 'APPROVED', decided_by = ${pm.id}, decided_at = now()`), /security check before approval/);
    await securityReview(pm, id, { note: "Checked" });
    await expectDbError(raw(pm2, sql`security_reviewed_by = ${pm2.id}`), /already recorded/);
    await expectDbError(raw(dev, sql`status = 'DRAFT'`), /can't go from SUBMITTED to DRAFT/);
    await decideRelease(pm2, id, { approve: true, note: "" });
    await expectDbError(raw(dev, sql`status = 'DEPLOYED', deployed_by = ${dev.id}, deployed_at = now()`), /someone else must deploy/);
  });

  it("a company that allows one person to do it all can approve its own releases", async () => {
    // The test company allows one person to approve and pay themselves (like older companies).
    const pm = await createUser("PROJECT_MANAGER");
    const admin = await createUser("ADMIN");
    await setReleaseControl(admin, { on: true, reason: "Testing" });
    const project = await createProject(pm, { name: "Solo", clientType: "INTERNAL", totalValue: "10", splitMode: "PERCENTAGE", projectOwnerId: pm.id });
    const id = await createRelease(pm, project.id, release({ securityImpact: "HIGH" }));
    await submitRelease(pm, id);
    await securityReview(pm, id, { note: "Checked my own work" });
    await decideRelease(pm, id, { approve: true, note: "" });
    await markDeployed(pm, id, { note: "" });
    expect(await statusOf(id)).toBe("DEPLOYED");
    await setReleaseControl(admin, { on: false, reason: "Done testing" });
  });
});

describe("evidence export", () => {
  it("Admins download every release in the dates with who did each step; the download is audited", async () => {
    const { org, owner, pm, pm2, dev, project } = await company();
    const id = await createRelease(dev, project.id, release({ title: "=HYPERLINK(\"x\")" }));
    await submitRelease(dev, id);
    await decideRelease(pm2, id, { approve: true, note: "Fine" });
    await markDeployed(pm, id, { note: "" });
    const today = new Date().toISOString().slice(0, 10);
    await expect(releaseEvidenceCsv(pm, { from: today, to: today })).rejects.toThrow(/Not allowed/);
    await expect(releaseEvidenceCsv(owner, { from: today, to: "2000-01-01" })).rejects.toThrow(/before the start/);
    const csv = await releaseEvidenceCsv(owner, { from: today, to: today });
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"Approved by someone other than the author"');
    expect(lines[1]).toContain(`'=HYPERLINK`);
    expect(lines[1]).toContain(dev.id);
    expect(lines[1]).toMatch(/"Approved","PROJECT_MANAGER [^"]+","[^"]+","Fine"/);
    expect(lines[1].endsWith('"Yes","Yes"')).toBe(true);
    expect(await releaseEvidenceCsv(owner, { from: "2000-01-01", to: "2000-01-02" })).not.toContain("HYPERLINK");
    const [event] = await db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, org.id), eq(auditEvents.action, "release.evidence_exported")));
    expect(event.afterJson).toMatchObject({ releases: 1 });
  });
});
