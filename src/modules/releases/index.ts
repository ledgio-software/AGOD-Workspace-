import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { orgMembers, organizations, projects, releases, users } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/dates";
import { type Actor, assertCan, can } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { notify } from "@/modules/notifications";
import { toCsv } from "@/modules/reports/csv";

// Phase 32: release approvals (change control), for teams that must show who changed what.
//   A release is written as a draft (what changes, why, how it was tested, how to undo it, and its
//   security impact), then submitted. Someone other than the author does the security check (needed
//   before approving a HIGH-impact release); a manager other than the author approves or rejects it;
//   someone other than the author marks it deployed, and anyone on the project can record a rollback.
//   Emergency releases can be deployed before approval and are approved afterwards.
//   The database enforces the same order and the same "not the author" rules (releases_guard).
//   Admins export everything as evidence for auditors.

export const IMPACTS = ["LOW", "MEDIUM", "HIGH"] as const;
export type Impact = (typeof IMPACTS)[number];
export type ReleaseStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "DEPLOYED" | "ROLLED_BACK";

export const impactLabel: Record<Impact, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };
export const statusLabel: Record<ReleaseStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  DEPLOYED: "Deployed",
  ROLLED_BACK: "Rolled back",
};

const text = (min: number, max: number, what: string) =>
  z.string().trim().min(min, `${what} (at least ${min} characters)`).max(max, `${what}: at most ${max.toLocaleString("en-GB")} characters`);
const note = (what: string) => z.string().trim().max(2000, `${what}: at most 2,000 characters`);

export const releaseInput = z.object({
  title: text(3, 200, "Give the release a name"),
  versionLabel: z
    .string()
    .trim()
    .max(50, "Version: at most 50 characters")
    .transform((v) => v || null),
  changeSummary: text(10, 4000, "Say what changes"),
  reason: text(3, 2000, "Say why"),
  securityImpact: z.enum(IMPACTS, { error: "Choose the security impact" }),
  testEvidence: text(3, 4000, "Say how it was tested"),
  rollbackPlan: text(3, 2000, "Say how to undo it"),
  emergency: z.boolean(),
});

export const stepInput = z.object({ note: note("Note") });
export const decideInput = z
  .object({ approve: z.boolean(), note: note("Note") })
  .refine((v) => v.approve || v.note.length >= 3, { path: ["note"], message: "Say why it's rejected (at least 3 characters)" });
const requiredNote = (what: string) => z.object({ note: text(3, 2000, what) });

export type Release = typeof releases.$inferSelect;

/** Whether the company has release approvals switched on (Company page; on for fintech teams). */
export async function releaseControlOn(actor: Actor): Promise<boolean> {
  return withActor(actor, async (tx) => {
    const [o] = await tx.select({ on: organizations.releaseControl }).from(organizations).where(eq(organizations.id, actor.orgId));
    return o?.on ?? false;
  });
}

async function oneMoneyPerson(tx: Tx, orgId: string): Promise<boolean> {
  const [o] = await tx.select({ allow: organizations.allowSelfApproval }).from(organizations).where(eq(organizations.id, orgId));
  return o?.allow ?? false;
}

/** Locks a release the actor can see (row-level security hides the others) with its project. */
async function lockRelease(tx: Tx, releaseId: string) {
  if (!z.uuid().safeParse(releaseId).success) throw new ServiceError("Release not found.");
  const [row] = await tx
    .select({ release: releases, code: projects.code, name: projects.name, ownerId: projects.projectOwnerId })
    .from(releases)
    .innerJoin(projects, eq(projects.id, releases.projectId))
    .where(eq(releases.id, releaseId))
    .for("update", { of: releases });
  if (!row) throw new ServiceError("Release not found.");
  return row;
}

async function managers(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.active, true), or(eq(orgMembers.role, "PROJECT_MANAGER"), eq(orgMembers.role, "ADMIN"))));
  return rows.map((r) => r.id);
}

const isAuthor = (r: Release, actorId: string) => r.createdBy === actorId || r.submittedBy === actorId;

async function audit(tx: Tx, actor: Actor, r: Release, action: string, after: Record<string, unknown>, reason: string | null, request?: RequestMeta) {
  await recordAudit(tx, {
    actorId: actor.id,
    entityType: "release",
    entityId: r.id,
    projectId: r.projectId,
    action,
    before: { status: r.status },
    after,
    reason,
    request,
  });
}

// --- Writing ---------------------------------------------------------------------------------

export async function createRelease(actor: Actor, projectId: string, raw: z.input<typeof releaseInput>, request?: RequestMeta): Promise<string> {
  const input = releaseInput.parse(raw);
  return withActor(actor, async (tx) => {
    const [o] = await tx.select({ on: organizations.releaseControl }).from(organizations).where(eq(organizations.id, actor.orgId));
    if (!o?.on) throw new ServiceError("Release approvals are switched off for this company. An Admin can switch them on on the Company page.");
    // Row-level security hides projects the actor can't see; that is the membership check.
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
    if (!project) throw new ServiceError("Project not found.");
    assertCan(actor, "release.manage", { isProjectMember: true });
    const [row] = await tx
      .insert(releases)
      .values({ projectId, createdBy: actor.id, ...input })
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "release", entityId: row.id, projectId, action: "release.created", after: input, request });
    return row.id;
  });
}

export async function updateDraft(actor: Actor, releaseId: string, raw: z.input<typeof releaseInput>, request?: RequestMeta) {
  const input = releaseInput.parse(raw);
  await withActor(actor, async (tx) => {
    const { release: r } = await lockRelease(tx, releaseId);
    if (r.status !== "DRAFT") throw new ServiceError("A submitted release can't be edited. Take it back to draft first, or reject it and record a new one.");
    if (r.createdBy !== actor.id && !can(actor, "release.approve")) throw new ServiceError("Only the person who wrote it, or a manager, can change it.");
    await tx.update(releases).set({ ...input, updatedAt: new Date() }).where(eq(releases.id, r.id)).catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "release",
      entityId: r.id,
      projectId: r.projectId,
      action: "release.updated",
      before: { title: r.title, versionLabel: r.versionLabel, changeSummary: r.changeSummary, reason: r.reason, securityImpact: r.securityImpact, testEvidence: r.testEvidence, rollbackPlan: r.rollbackPlan, emergency: r.emergency },
      after: input,
      request,
    });
  });
}

/** Sends a draft for approval; managers are told. */
export async function submitRelease(actor: Actor, releaseId: string, request?: RequestMeta) {
  await withActor(actor, async (tx) => {
    const { release: r, code } = await lockRelease(tx, releaseId);
    assertCan(actor, "release.manage", { isProjectMember: true });
    if (r.status !== "DRAFT") throw new ServiceError("Only a draft can be submitted.");
    if (r.createdBy !== actor.id && !can(actor, "release.approve")) throw new ServiceError("Only the person who wrote it, or a manager, can submit it.");
    const now = new Date();
    await tx.update(releases).set({ status: "SUBMITTED", submittedBy: actor.id, submittedAt: now, updatedAt: now }).where(eq(releases.id, r.id)).catch(rethrowDbGuard);
    await audit(tx, actor, r, "release.submitted", { status: "SUBMITTED" }, null, request);
    const check = r.securityImpact === "HIGH" ? " It has a high security impact, so it needs a security check first." : "";
    const urgent = r.emergency ? "Emergency release: " : "";
    for (const recipientId of await managers(tx)) {
      await notify(tx, actor, {
        recipientId,
        type: "release.submitted",
        title: `${urgent}Release waiting for approval on ${code}`,
        message: `"${r.title}" was submitted.${check}`,
        entityType: "release",
        entityId: r.id,
      });
    }
  });
}

/** Takes a submitted release back to draft (before anyone has checked or decided it). */
export async function withdrawRelease(actor: Actor, releaseId: string, request?: RequestMeta) {
  await withActor(actor, async (tx) => {
    const { release: r } = await lockRelease(tx, releaseId);
    if (r.status !== "SUBMITTED") throw new ServiceError("Only a release waiting for approval can be taken back.");
    if (!isAuthor(r, actor.id) && !can(actor, "release.approve")) throw new ServiceError("Only the person who wrote it, or a manager, can take it back.");
    if (r.securityReviewedBy) throw new ServiceError("The security check is already done, so it can't go back to draft. Reject it and record a new one.");
    await tx.update(releases).set({ status: "DRAFT", updatedAt: new Date() }).where(eq(releases.id, r.id)).catch(rethrowDbGuard);
    await audit(tx, actor, r, "release.withdrawn", { status: "DRAFT" }, null, request);
  });
}

/** The security check, by someone other than the author. */
export async function securityReview(actor: Actor, releaseId: string, raw: z.input<typeof stepInput>, request?: RequestMeta) {
  const { note: text } = requiredNote("Say what you checked").parse(raw);
  await withActor(actor, async (tx) => {
    const { release: r, code } = await lockRelease(tx, releaseId);
    assertCan(actor, "release.manage", { isProjectMember: true });
    if (r.securityReviewedBy) throw new ServiceError("The security check is already recorded.");
    const open = r.status === "SUBMITTED" || (r.status === "DEPLOYED" && r.emergency && !r.decidedBy);
    if (!open) throw new ServiceError("This release isn't waiting for a security check.");
    if (isAuthor(r, actor.id) && !(await oneMoneyPerson(tx, actor.orgId))) throw new ServiceError("You wrote this release, so someone else must do the security check.");
    const now = new Date();
    await tx.update(releases).set({ securityReviewedBy: actor.id, securityReviewedAt: now, securityNote: text, updatedAt: now }).where(eq(releases.id, r.id)).catch(rethrowDbGuard);
    await audit(tx, actor, r, "release.security_checked", { securityReviewed: true }, text, request);
    await notify(tx, actor, {
      recipientId: r.createdBy,
      type: "release.security_checked",
      title: `Security check done on ${code}`,
      message: `"${r.title}": ${text}`,
      entityType: "release",
      entityId: r.id,
    });
  });
}

/** A manager other than the author approves or rejects. Emergency releases are decided after deployment. */
export async function decideRelease(actor: Actor, releaseId: string, raw: z.input<typeof decideInput>, request?: RequestMeta) {
  const input = decideInput.parse(raw);
  assertCan(actor, "release.approve");
  await withActor(actor, async (tx) => {
    const { release: r, code } = await lockRelease(tx, releaseId);
    if (r.decidedBy) throw new ServiceError("This release is already decided.");
    const afterDeploy = r.status === "DEPLOYED" && r.emergency;
    if (r.status !== "SUBMITTED" && !afterDeploy) throw new ServiceError("This release isn't waiting for a decision.");
    if (isAuthor(r, actor.id) && !(await oneMoneyPerson(tx, actor.orgId))) throw new ServiceError("You wrote this release, so another manager must approve it.");
    if (input.approve && r.securityImpact === "HIGH" && !r.securityReviewedBy) throw new ServiceError("A high-impact release needs a security check before approval.");
    const now = new Date();
    const decision = input.approve ? "APPROVED" : "REJECTED";
    await tx
      .update(releases)
      .set({ ...(afterDeploy ? {} : { status: decision }), decision, decidedBy: actor.id, decidedAt: now, decisionNote: input.note || null, updatedAt: now })
      .where(eq(releases.id, r.id))
      .catch(rethrowDbGuard);
    await audit(tx, actor, r, input.approve ? "release.approved" : "release.rejected", { status: afterDeploy ? r.status : decision, decision }, input.note || null, request);
    const later = afterDeploy && !input.approve ? " It is already live: roll it back." : "";
    for (const recipientId of new Set([r.createdBy, r.submittedBy ?? r.createdBy])) {
      await notify(tx, actor, {
        recipientId,
        type: `release.${decision.toLowerCase()}`,
        title: `Release ${input.approve ? "approved" : "rejected"} on ${code}`,
        message: `"${r.title}"${input.note ? `: ${input.note}` : "."}${later}`,
        entityType: "release",
        entityId: r.id,
      });
    }
  });
}

/** Records that an approved release is live (an emergency one may go live before approval). */
export async function markDeployed(actor: Actor, releaseId: string, raw: z.input<typeof stepInput>, request?: RequestMeta) {
  const { note: text } = stepInput.parse(raw);
  await withActor(actor, async (tx) => {
    const { release: r, code } = await lockRelease(tx, releaseId);
    assertCan(actor, "release.manage", { isProjectMember: true });
    const emergency = r.status === "SUBMITTED" && r.emergency;
    if (r.status !== "APPROVED" && !emergency) throw new ServiceError("Only an approved release (or an emergency one) can be deployed.");
    if (emergency && text.length < 3) throw new ServiceError("Say why this can't wait for approval (at least 3 characters).");
    if (r.createdBy === actor.id && !(await oneMoneyPerson(tx, actor.orgId))) throw new ServiceError("You wrote this release, so someone else must deploy it.");
    const now = new Date();
    await tx.update(releases).set({ status: "DEPLOYED", deployedBy: actor.id, deployedAt: now, deployNote: text || null, updatedAt: now }).where(eq(releases.id, r.id)).catch(rethrowDbGuard);
    await audit(tx, actor, r, emergency ? "release.deployed_emergency" : "release.deployed", { status: "DEPLOYED" }, text || null, request);
    if (emergency) {
      for (const recipientId of await managers(tx)) {
        await notify(tx, actor, {
          recipientId,
          type: "release.deployed_emergency",
          title: `Emergency release deployed on ${code}`,
          message: `"${r.title}" went live before approval: ${text} Approve or reject it now.`,
          entityType: "release",
          entityId: r.id,
        });
      }
    }
  });
}

/** Records that a deployed release was undone. */
export async function markRolledBack(actor: Actor, releaseId: string, raw: z.input<typeof stepInput>, request?: RequestMeta) {
  const { note: text } = requiredNote("Say what went wrong").parse(raw);
  await withActor(actor, async (tx) => {
    const { release: r, code } = await lockRelease(tx, releaseId);
    assertCan(actor, "release.manage", { isProjectMember: true });
    if (r.status !== "DEPLOYED") throw new ServiceError("Only a deployed release can be rolled back.");
    const now = new Date();
    await tx.update(releases).set({ status: "ROLLED_BACK", rolledBackBy: actor.id, rolledBackAt: now, rollbackNote: text, updatedAt: now }).where(eq(releases.id, r.id)).catch(rethrowDbGuard);
    await audit(tx, actor, r, "release.rolled_back", { status: "ROLLED_BACK" }, text, request);
    for (const recipientId of new Set([r.createdBy, ...(await managers(tx))])) {
      await notify(tx, actor, {
        recipientId,
        type: "release.rolled_back",
        title: `Release rolled back on ${code}`,
        message: `"${r.title}": ${text}`,
        entityType: "release",
        entityId: r.id,
      });
    }
  });
}

// --- Reading ---------------------------------------------------------------------------------

export type ReleaseRow = {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  title: string;
  versionLabel: string | null;
  securityImpact: Impact;
  emergency: boolean;
  status: ReleaseStatus;
  decision: string | null;
  securityReviewed: boolean;
  authorName: string;
  createdAt: Date;
  updatedAt: Date;
};

function listQuery(tx: Tx) {
  return tx
    .select({
      id: releases.id,
      projectId: releases.projectId,
      projectCode: projects.code,
      projectName: projects.name,
      title: releases.title,
      versionLabel: releases.versionLabel,
      securityImpact: releases.securityImpact,
      emergency: releases.emergency,
      status: releases.status,
      decision: releases.decision,
      securityReviewedBy: releases.securityReviewedBy,
      authorName: users.name,
      createdAt: releases.createdAt,
      updatedAt: releases.updatedAt,
    })
    .from(releases)
    .innerJoin(projects, eq(projects.id, releases.projectId))
    .innerJoin(users, eq(users.id, releases.createdBy));
}

type ListRow = Awaited<ReturnType<ReturnType<typeof listQuery>["execute"]>>[number];
const toRow = ({ securityReviewedBy, ...r }: ListRow): ReleaseRow => ({
  ...r,
  securityImpact: r.securityImpact as Impact,
  status: r.status as ReleaseStatus,
  securityReviewed: securityReviewedBy !== null,
});

export async function listProjectReleases(actor: Actor, projectId: string): Promise<ReleaseRow[]> {
  return withActor(actor, async (tx) => (await listQuery(tx).where(eq(releases.projectId, projectId)).orderBy(desc(releases.createdAt))).map(toRow));
}

/** The releases page: what's waiting on someone, then the most recent. */
export async function releaseOverview(actor: Actor) {
  return withActor(actor, async (tx) => {
    const waiting = (
      await listQuery(tx)
        .where(or(eq(releases.status, "SUBMITTED"), and(eq(releases.status, "DEPLOYED"), eq(releases.emergency, true), sql`${releases.decidedBy} IS NULL`)))
        .orderBy(desc(releases.emergency), releases.submittedAt)
    ).map(toRow);
    const recent = (await listQuery(tx).orderBy(desc(releases.updatedAt)).limit(50)).map(toRow);
    return { waiting, recent: recent.filter((r) => !waiting.some((w) => w.id === r.id)) };
  });
}

/** How many releases are waiting for this person (approvals for managers). */
export async function releasesWaitingCount(actor: Actor): Promise<number> {
  if (!can(actor, "release.approve")) return 0;
  return withActor(actor, async (tx) => {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(releases)
      .where(
        and(
          or(eq(releases.status, "SUBMITTED"), and(eq(releases.status, "DEPLOYED"), eq(releases.emergency, true), sql`${releases.decidedBy} IS NULL`)),
          sql`${releases.createdBy} <> ${actor.id}`,
        ),
      );
    return n;
  });
}

export type Person = { id: string; name: string } | null;

export type ReleaseDetail = {
  release: Release;
  project: { id: string; code: string; name: string };
  people: { author: Person; submittedBy: Person; securityReviewedBy: Person; decidedBy: Person; deployedBy: Person; rolledBackBy: Person };
  /** What this person may do now, with the reason when a step is blocked for them. */
  can: { edit: boolean; submit: boolean; withdraw: boolean; securityCheck: boolean; decide: boolean; deploy: boolean; rollBack: boolean };
  blocked: { securityCheck?: string; decide?: string; deploy?: string };
};

export async function getRelease(actor: Actor, releaseId: string): Promise<ReleaseDetail | null> {
  if (!z.uuid().safeParse(releaseId).success) return null;
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ release: releases, code: projects.code, name: projects.name })
      .from(releases)
      .innerJoin(projects, eq(projects.id, releases.projectId))
      .where(eq(releases.id, releaseId));
    if (!row) return null;
    const r = row.release;
    const ids = [r.createdBy, r.submittedBy, r.securityReviewedBy, r.decidedBy, r.deployedBy, r.rolledBackBy].filter((v): v is string => !!v);
    const names = new Map((await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]));
    const person = (id: string | null): Person => (id ? { id, name: names.get(id) ?? "Someone" } : null);
    const onePerson = await oneMoneyPerson(tx, actor.orgId);
    const manage = can(actor, "release.manage", { isProjectMember: true });
    const approver = can(actor, "release.approve");
    const author = isAuthor(r, actor.id) && !onePerson;
    const mine = r.createdBy === actor.id || approver;
    const awaitingDecision = !r.decidedBy && (r.status === "SUBMITTED" || (r.status === "DEPLOYED" && r.emergency));
    const blocked: ReleaseDetail["blocked"] = {};
    if (author) {
      blocked.securityCheck = "You wrote this release, so someone else must do the security check.";
      blocked.decide = "You wrote this release, so another manager must approve it.";
    }
    if (r.createdBy === actor.id && !onePerson) blocked.deploy = "You wrote this release, so someone else must deploy it.";
    if (!blocked.decide && r.securityImpact === "HIGH" && !r.securityReviewedBy) blocked.decide = "High security impact: the security check comes first. You can still reject it.";
    return {
      release: r,
      project: { id: r.projectId, code: row.code, name: row.name },
      people: {
        author: person(r.createdBy),
        submittedBy: person(r.submittedBy),
        securityReviewedBy: person(r.securityReviewedBy),
        decidedBy: person(r.decidedBy),
        deployedBy: person(r.deployedBy),
        rolledBackBy: person(r.rolledBackBy),
      },
      can: {
        edit: r.status === "DRAFT" && mine,
        submit: r.status === "DRAFT" && manage && mine,
        withdraw: r.status === "SUBMITTED" && !r.securityReviewedBy && (isAuthor(r, actor.id) || approver),
        securityCheck: manage && !r.securityReviewedBy && awaitingDecision && !author,
        decide: approver && awaitingDecision && !author,
        deploy: manage && (r.status === "APPROVED" || (r.status === "SUBMITTED" && r.emergency)) && !blocked.deploy,
        rollBack: manage && r.status === "DEPLOYED",
      },
      blocked,
    };
  });
}

// --- Evidence export -------------------------------------------------------------------------

export const exportInput = z
  .object({
    from: z.iso.date({ error: "Choose a start date" }),
    to: z.iso.date({ error: "Choose an end date" }),
  })
  .refine((v) => v.from <= v.to, { path: ["to"], message: "The end date is before the start date" });

const EVIDENCE_HEADERS = [
  "Project code",
  "Project name",
  "Release",
  "Version",
  "Security impact",
  "Emergency",
  "Status",
  "What changes",
  "Why",
  "How it was tested",
  "How to undo it",
  "Written by",
  "Written at",
  "Submitted by",
  "Submitted at",
  "Security check by",
  "Security check at",
  "Security check note",
  "Decision",
  "Decided by",
  "Decided at",
  "Decision note",
  "Deployed by",
  "Deployed at",
  "Deploy note",
  "Rolled back by",
  "Rolled back at",
  "Rollback note",
  "Approved by someone other than the author",
  "Deployed by someone other than the author",
];

/**
 * Admins: every release written in the date range (Accra time), with who did each step, as CSV for
 * auditors. The export itself is recorded in the audit log.
 */
export async function releaseEvidenceCsv(actor: Actor, raw: z.input<typeof exportInput>, request?: RequestMeta): Promise<string> {
  assertCan(actor, "audit.viewAll");
  const { from, to } = exportInput.parse(raw);
  return withActor(actor, async (tx) => {
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000);
    const rows = await tx
      .select({ release: releases, code: projects.code, name: projects.name })
      .from(releases)
      .innerJoin(projects, eq(projects.id, releases.projectId))
      .where(and(gte(releases.createdAt, start), lt(releases.createdAt, end)))
      .orderBy(releases.createdAt);
    const ids = [...new Set(rows.flatMap(({ release: r }) => [r.createdBy, r.submittedBy, r.securityReviewedBy, r.decidedBy, r.deployedBy, r.rolledBackBy]).filter((v): v is string => !!v))];
    const names = new Map(ids.length ? (await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, `${u.name} <${u.email}>`]) : []);
    const who = (id: string | null) => (id ? (names.get(id) ?? id) : "");
    const at = (d: Date | null) => (d ? formatDateTime(d) : "");
    const yesNo = (done: boolean, ok: boolean) => (done ? (ok ? "Yes" : "No") : "");
    const csv = toCsv(
      EVIDENCE_HEADERS,
      rows.map(({ release: r, code, name }) => [
        code,
        name,
        r.title,
        r.versionLabel ?? "",
        impactLabel[r.securityImpact as Impact],
        r.emergency ? "Yes" : "No",
        statusLabel[r.status as ReleaseStatus],
        r.changeSummary,
        r.reason,
        r.testEvidence,
        r.rollbackPlan,
        who(r.createdBy),
        at(r.createdAt),
        who(r.submittedBy),
        at(r.submittedAt),
        who(r.securityReviewedBy),
        at(r.securityReviewedAt),
        r.securityNote ?? "",
        r.decision === "APPROVED" ? "Approved" : r.decision === "REJECTED" ? "Rejected" : "",
        who(r.decidedBy),
        at(r.decidedAt),
        r.decisionNote ?? "",
        who(r.deployedBy),
        at(r.deployedAt),
        r.deployNote ?? "",
        who(r.rolledBackBy),
        at(r.rolledBackAt),
        r.rollbackNote ?? "",
        yesNo(r.decidedBy !== null, r.decidedBy !== r.createdBy && r.decidedBy !== r.submittedBy),
        yesNo(r.deployedBy !== null, r.deployedBy !== r.createdBy),
      ]),
    );
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "organization",
      entityId: actor.orgId,
      action: "release.evidence_exported",
      after: { from, to, releases: rows.length },
      request,
    });
    return csv;
  });
}
