import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { invoiceSettings, memberships, organizations, projectTemplates } from "@/lib/db/schema";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { isUniqueViolation } from "@/modules/db-errors";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
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
 * invoice settings. Returns the new company.
 */
export async function createOrganization(input: { name: string; ownerId: string; projectCodePrefix?: string; slug?: string }) {
  const companyName = name.parse(input.name);
  const codePrefix = prefix.parse(input.projectCodePrefix ?? suggestPrefix(companyName));
  const base = input.slug ?? slugify(companyName);
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 35)}-${attempt + 1}`;
    try {
      return await db.transaction(async (tx) => {
        const [org] = await tx.insert(organizations).values({ name: companyName, slug, projectCodePrefix: codePrefix, createdBy: input.ownerId }).returning();
        await tx.insert(memberships).values({ organizationId: org.id, userId: input.ownerId, role: "ADMIN" });
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
