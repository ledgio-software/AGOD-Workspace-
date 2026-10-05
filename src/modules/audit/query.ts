import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/lib/db/actor";
import { auditEvents, projects, users } from "@/lib/db/schema";
import { type Actor, assertCan, can } from "@/lib/permissions";

export const auditFilters = z.object({
  projectId: z.uuid().optional().catch(undefined),
  actorId: z.uuid().optional().catch(undefined),
  action: z.string().trim().max(100).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).optional().catch(undefined),
});

const PAGE_SIZE = 100;

/**
 * The audit trail (design doc sections 4 and 13): Admins see everything, PMs the history of
 * projects they can view (row-level security narrows it further), members never see this page.
 * Oldest first within a project, so status transitions read in the order they happened.
 */
export async function listAuditEvents(actor: Actor, raw: z.input<typeof auditFilters> = {}) {
  assertCan(actor, "audit.viewProject");
  const filters = auditFilters.parse(raw);
  return withActor(actor, async (tx) => {
    const conditions = [];
    if (filters.projectId) conditions.push(eq(auditEvents.projectId, filters.projectId));
    if (filters.actorId) conditions.push(eq(auditEvents.actorId, filters.actorId));
    if (filters.action) conditions.push(eq(auditEvents.action, filters.action));
    if (filters.from) conditions.push(gte(auditEvents.createdAt, new Date(`${filters.from}T00:00:00Z`)));
    if (filters.to) conditions.push(lte(auditEvents.createdAt, new Date(`${filters.to}T23:59:59.999Z`)));
    const page = filters.page ?? 1;
    const rows = await tx
      .select({ event: auditEvents, actorName: users.name, projectCode: projects.code })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .leftJoin(projects, eq(projects.id, auditEvents.projectId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditEvents.createdAt))
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE);
    return {
      events: rows.slice(0, PAGE_SIZE).map((r) => ({ ...r.event, actorName: r.actorName, projectCode: r.projectCode })),
      page,
      hasMore: rows.length > PAGE_SIZE,
      scope: can(actor, "audit.viewAll") ? ("all" as const) : ("projects" as const),
    };
  });
}

/** Field-level differences between before and after snapshots, for display. */
export function diffJson(before: unknown, after: unknown): { field: string; before: unknown; after: unknown }[] {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((field) => ({ field, before: b[field], after: a[field] }));
}
