import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, pgView, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userRole, users } from "./auth";

// Phase 22: companies (workspaces). Every company's data is kept apart by organization_id on
// each domain table, enforced by row-level security for the app role (see the
// *_organizations_rules migration). A person has one login and a membership, with its own role,
// in each company they belong to.

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Short, unique, used in links later (e.g. /c/agod).
    slug: text("slug").notNull().unique(),
    // Project codes are <prefix>-<year>-<number>, e.g. AGOD-2026-001.
    projectCodePrefix: text("project_code_prefix").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("organizations_name", sql`length(btrim(${t.name})) BETWEEN 2 AND 120`),
    check("organizations_slug", sql`${t.slug} ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'`),
    check("organizations_code_prefix", sql`${t.projectCodePrefix} ~ '^[A-Z][A-Z0-9]{1,7}$'`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: userRole("role").notNull().default("TEAM_MEMBER"),
    // Inactive members stay in this company's history but can no longer work in it.
    active: boolean("active").notNull().default(true),
    // Hours per week available for this company's project work (workload view).
    weeklyCapacityHours: integer("weekly_capacity_hours").notNull().default(40),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("memberships_org_user").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
    check("memberships_capacity", sql`${t.weeklyCapacityHours} BETWEEN 0 AND 80`),
  ],
);

/**
 * The people of the current company (app.org_id) with their role, capacity and whether they are
 * active here (membership and login both active). Use it wherever role or "active" matters; join
 * `users` only for names. It runs with the caller's permissions (security_invoker).
 */
export const orgMembers = pgView("org_members", {
  id: uuid("id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  role: userRole("role").notNull(),
  active: boolean("active").notNull(),
  weeklyCapacityHours: integer("weekly_capacity_hours").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}).existing();
