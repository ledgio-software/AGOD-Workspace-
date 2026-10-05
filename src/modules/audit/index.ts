import { createHmac } from "node:crypto";
import type { Tx } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";

export type RequestMeta = { ip?: string | null; userAgent?: string | null };

export type AuditInput = {
  /** Null for changes made by the system itself (the GitHub webhook). */
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  projectId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  request?: RequestMeta;
};

/** Keyed hash: lets us correlate requests from the same IP without storing the IP itself. */
export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

/**
 * Appends an audit event inside the caller's transaction, so the event is committed if and only
 * if the change it describes is committed. `audit_events` is append-only (enforced by trigger).
 */
export async function recordAudit(tx: Tx, input: AuditInput): Promise<void> {
  const secret = process.env.BETTER_AUTH_SECRET;
  const ip = input.request?.ip;
  await tx.insert(auditEvents).values({
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    projectId: input.projectId ?? null,
    action: input.action,
    beforeJson: input.before ?? null,
    afterJson: input.after ?? null,
    reason: input.reason ?? null,
    ipHash: ip && secret ? hashIp(ip, secret) : null,
    userAgent: input.request?.userAgent?.slice(0, 500) ?? null,
  });
}
