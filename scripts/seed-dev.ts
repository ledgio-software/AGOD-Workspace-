// Seeds TEST users into a development database. Never run against staging or production.
// Phase 22: they all join the company "AGOD" (created, with the Admin as its owner, if missing).
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

const TEST_USERS = [
  { name: "Test Admin", email: "admin@agod.test", role: "ADMIN" },
  { name: "Test Project Manager", email: "pm@agod.test", role: "PROJECT_MANAGER" },
  { name: "Test Team Member", email: "member@agod.test", role: "TEAM_MEMBER" },
] as const;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_SEED !== "true") {
    throw new Error("Refusing to seed: set ALLOW_DEV_SEED=true, and only for a development database.");
  }
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error("Set SEED_PASSWORD (at least 10 characters) for the test accounts.");
  }
  // Imported after the guard so nothing connects before it passes.
  const { hashPassword } = await import("better-auth/crypto");
  const { and, eq } = await import("drizzle-orm");
  const { db } = await import("../src/lib/db");
  const { accounts, memberships, organizations, users } = await import("../src/lib/db/schema");
  const { createOrganization } = await import("../src/modules/orgs");
  const passwordHash = await hashPassword(password);

  const ids = new Map<string, string>();
  for (const seed of TEST_USERS) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, seed.email));
    if (existing) {
      ids.set(seed.email, existing.id);
      console.log(`exists  ${seed.email}`);
      continue;
    }
    const id = await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ name: seed.name, email: seed.email, emailVerified: true }).returning({ id: users.id });
      await tx.insert(accounts).values({ userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash });
      return user.id;
    });
    ids.set(seed.email, id);
    console.log(`created ${seed.email}`);
  }

  let [org] = await db.select().from(organizations).where(eq(organizations.slug, "agod"));
  if (!org) {
    org = await createOrganization({ name: "AGOD", slug: "agod", projectCodePrefix: "AGOD", ownerId: ids.get(TEST_USERS[0].email)! });
    console.log("created company AGOD");
  }
  for (const seed of TEST_USERS) {
    const userId = ids.get(seed.email)!;
    const [member] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.organizationId, org.id), eq(memberships.userId, userId)));
    if (!member) await db.insert(memberships).values({ organizationId: org.id, userId, role: seed.role });
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
