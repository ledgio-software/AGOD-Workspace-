import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { companyRoles, invoiceSettings, jobTitles, memberships, organizations, projectTemplates } from "@/lib/db/schema";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { isUniqueViolation } from "@/modules/db-errors";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { JOB_TITLE_PRESETS, ROLE_PRESETS, type TeamType } from "@/modules/roles/presets";
import { STARTER_TEMPLATES } from "./starter-templates";

// Phase 22: companies (workspaces). Creating one is a system action (the sign-up flow, scripts
// and tests); its Admins then manage its name and project code prefix.

const name = z.string().trim().min(2, "Give the company a name (at least 2 characters)").max(120);
const prefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,7}$/, "2 to 8 letters or digits, starting with a letter (e.g. ACME)");

/** "Acme Digital Ltd" → "acme-digital-ltd" (the caller makes it unique). */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length >= 1 ? slug : "company";
}

/** "Acme Digital Ltd" → "ACME" (first word, letters and digits, 2-8 characters). */
export function suggestPrefix(text: string): string {
  const word = text
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^A-Z0-9 ]/g, "")
    .split(/\s+/)
    .find((w) => /^[A-Z]/.test(w));
  const p = (word ?? "CO").slice(0, 8);
  return p.length >= 2 ? p : `${p}CO`.slice(0, 8);
}

/**
 * Creates a company with `ownerId` as its first Admin, the starter project templates and default
 * invoice settings. With a team type (Phase 28) it also gets that kind of team's suggested job
 * titles and roles. Returns the new company.
 */
export async function createOrganization(input: { name: string; ownerId: string; projectCodePrefix?: string; slug?: string; teamType?: TeamType }) {
  const companyName = name.parse(input.name);
  const codePrefix = prefix.parse(input.projectCodePrefix ?? suggestPrefix(companyName));
  const base = input.slug ?? slugify(companyName);
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 35)}-${attempt + 1}`;
    try {
      return await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({ name: companyName, slug, projectCodePrefix: codePrefix, createdBy: input.ownerId, teamType: input.teamType ?? "OTHER", releaseControl: input.teamType === "FINTECH" })
          .returning();
        await tx.insert(memberships).values({ organizationId: org.id, userId: input.ownerId, role: "ADMIN" });
        if (input.teamType) {
          await tx.insert(jobTitles).values(JOB_TITLE_PRESETS[input.teamType].map((name) => ({ organizationId: org.id, name })));
          await tx
            .insert(companyRoles)
            .values(ROLE_PRESETS[input.teamType].map((r) => ({ organizationId: org.id, name: r.name, description: r.description, baseRole: r.baseRole, permissions: r.permissions, createdBy: input.ownerId })));
        }
        await tx.insert(projectTemplates).values(STARTER_TEMPLATES.map((t) => ({ ...t, organizationId: org.id })));
        await tx.insert(invoiceSettings).values({ organizationId: org.id, businessName: companyName });
        return org;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new ServiceError("Could not find a free short name for this company. Try a different name.");
}

export async function getOrganization(actor: Actor) {
  return withActor(actor, async (tx) => (await tx.select().from(organizations).where(eq(organizations.id, actor.orgId)))[0] ?? null);
}

export const organizationInput = z.object({ name, projectCodePrefix: prefix });

/** Admins: the company's name and the prefix of new project codes (existing codes keep theirs). */
export async function updateOrganization(actor: Actor, raw: z.input<typeof organizationInput>, request?: RequestMeta) {
  assertCan(actor, "company.manage");
  const input = organizationInput.parse(raw);
  await withActor(actor, async (tx) => {
    const [before] = await tx.select().from(organizations).where(eq(organizations.id, actor.orgId));
    if (!before) throw new ServiceError("Company not found.");
    if (before.name === input.name && before.projectCodePrefix === input.projectCodePrefix) return;
    await tx.update(organizations).set(input).where(eq(organizations.id, actor.orgId)).catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "organization",
      entityId: actor.orgId,
      action: "company.updated",
      before: { name: before.name, projectCodePrefix: before.projectCodePrefix },
      after: input,
      request,
    });
  });
}

export const selfApprovalInput = z.object({ allow: z.boolean(), reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500) });

/**
 * Phase 28, two people for money. Off: nobody approves a project they are paid on or asked to have
 * approved, or records a payment or adjustment on their own payout. On: allowed (for a team with one
 * manager), and every change of this setting is in the audit log with its reason.
 */
export async function setSelfApproval(actor: Actor, raw: z.input<typeof selfApprovalInput>, request?: RequestMeta) {
  assertCan(actor, "company.manage");
  const input = selfApprovalInput.parse(raw);
  await withActor(actor, async (tx) => {
    const [before] = await tx.select({ allow: organizations.allowSelfApproval }).from(organizations).where(eq(organizations.id, actor.orgId));
    if (!before) throw new ServiceError("Company not found.");
    if (before.allow === input.allow) return;
    await tx.update(organizations).set({ allowSelfApproval: input.allow }).where(eq(organizations.id, actor.orgId)).catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "organization",
      entityId: actor.orgId,
      action: "company.self_approval_changed",
      before: { allowSelfApproval: before.allow },
      after: { allowSelfApproval: input.allow },
      reason: input.reason,
      request,
    });
  });
}

export const releaseControlInput = z.object({ on: z.boolean(), reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500) });

/**
 * Phase 32: release approvals (change control) on or off for the company. On by default for fintech
 * teams. Every change is in the audit log with its reason.
 */
export async function setReleaseControl(actor: Actor, raw: z.input<typeof releaseControlInput>, request?: RequestMeta) {
  assertCan(actor, "company.manage");
  const input = releaseControlInput.parse(raw);
  await withActor(actor, async (tx) => {
    const [before] = await tx.select({ on: organizations.releaseControl }).from(organizations).where(eq(organizations.id, actor.orgId));
    if (!before) throw new ServiceError("Company not found.");
    if (before.on === input.on) return;
    await tx.update(organizations).set({ releaseControl: input.on }).where(eq(organizations.id, actor.orgId)).catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "organization",
      entityId: actor.orgId,
      action: "company.release_control_changed",
      before: { releaseControl: before.on },
      after: { releaseControl: input.on },
      reason: input.reason,
      request,
    });
  });
}
