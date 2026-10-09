import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// Phase 40: the AGOD back office (/console). Platform staff (PLATFORM_ADMIN_EMAILS) act across
// companies, so every action they take is written here, with the reason they gave. Like the
// community tables, the app role has no access; the server writes it after its own checks.

export const platformAudit = pgTable(
  "platform_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // e.g. COMPANY_SUSPENDED, LOGIN_BLOCKED, RESET_LINK_SENT, ORGANIZER_ADDED
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    // The target's name at the time, so the log still reads well if it changes later.
    targetLabel: text("target_label").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("platform_audit_created_idx").on(t.createdAt),
    index("platform_audit_target_idx").on(t.targetType, t.targetId),
    check("platform_audit_target_type", sql`${t.targetType} IN ('COMPANY', 'USER', 'PROFILE', 'CONTENT')`),
    check("platform_audit_reason", sql`${t.reason} IS NULL OR length(${t.reason}) <= 500`),
  ],
);
