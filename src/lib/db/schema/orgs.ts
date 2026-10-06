import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, integer, pgTable, pgView, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    // Phase 28: the kind of team, chosen at sign-up; it decides the suggested job titles and roles.
    teamType: text("team_type").notNull().default("OTHER"),
    // Phase 28: two people for money. When off (the default), nobody approves a project they are
    // paid on, or records a payment or adjustment on their own payout. Small teams may allow it.
    allowSelfApproval: boolean("allow_self_approval").notNull().default(false),
    // Phase 29: the client money flow. The deposit suggested for new payment plans (basis points),
    // whether a client project may start before its deposit is paid, how many working days a client
    // has to review delivered work, and when the team's payouts can be paid.
    defaultDepositBasisPoints: integer("default_deposit_basis_points").notNull().default(5000),
    requireDeposit: boolean("require_deposit").notNull().default(false),
    clientReviewDays: integer("client_review_days").notNull().default(10),
    // ON_APPROVAL: in full once the project is approved. ON_CLIENT_PAYMENT: in step with what the
    // client has paid for the project (internal projects: on approval).
    payoutRelease: text("payout_release").notNull().default("ON_APPROVAL"),
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
    check("organizations_team_type", sql`${t.teamType} IN ('SOFTWARE', 'FINTECH', 'OTHER')`),
    check("organizations_deposit", sql`${t.defaultDepositBasisPoints} BETWEEN 0 AND 10000`),
    check("organizations_review_days", sql`${t.clientReviewDays} BETWEEN 1 AND 60`),
    check("organizations_payout_release", sql`${t.payoutRelease} IN ('ON_APPROVAL', 'ON_CLIENT_PAYMENT')`),
  ],
);

/**
 * Phase 28: roles a company makes itself. Each starts from a base role (what the database allows)
 * and keeps a list of permission groups (src/lib/permissions); it can only narrow its base role.
 */
export const companyRoles = pgTable(
  "company_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .default(sql`app_org_id()`)
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    baseRole: userRole("base_role").notNull(),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("company_roles_org_name").on(t.organizationId, sql`lower(${t.name})`),
    check("company_roles_name", sql`length(btrim(${t.name})) BETWEEN 2 AND 60`),
  ],
);

/** Phase 28: a company's own list of job titles (Backend developer, QA, ...). They grant nothing. */
export const jobTitles = pgTable(
  "job_titles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .default(sql`app_org_id()`)
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_titles_org_name").on(t.organizationId, sql`lower(${t.name})`),
    check("job_titles_name", sql`length(btrim(${t.name})) BETWEEN 2 AND 60`),
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
    // Phase 28: a company-made role (null: the built-in role above). The database keeps `role`
    // equal to the company role's base role.
    companyRoleId: uuid("company_role_id").references((): AnyPgColumn => companyRoles.id, { onDelete: "restrict" }),
    jobTitleId: uuid("job_title_id").references((): AnyPgColumn => jobTitles.id, { onDelete: "restrict" }),
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
  companyRoleId: uuid("company_role_id"),
  jobTitleId: uuid("job_title_id"),
  active: boolean("active").notNull(),
  weeklyCapacityHours: integer("weekly_capacity_hours").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}).existing();
