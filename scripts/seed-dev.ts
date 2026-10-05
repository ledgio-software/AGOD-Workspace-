// Seeds TEST users into a development database. Never run against staging or production.
import { config } from "dotenv";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { normalizeDatabaseUrl } from "../src/lib/db/url";
import { accounts, users } from "../src/lib/db/schema";

config({ path: [".env.local", ".env"], quiet: true });

const TEST_USERS = [
  { name: "Test Admin", email: "admin@agod.test", role: "ADMIN" },
  { name: "Test Project Manager", email: "pm@agod.test", role: "PROJECT_MANAGER" },
  { name: "Test Team Member", email: "member@agod.test", role: "TEAM_MEMBER" },
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_SEED !== "true") {
    throw new Error(
      "Refusing to seed: set ALLOW_DEV_SEED=true, and only for a development database.",
    );
  }
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error("Set SEED_PASSWORD (at least 10 characters) for the test accounts.");
  }

  const pool = new Pool({ connectionString: normalizeDatabaseUrl(url) });
  const db = drizzle(pool);
  const passwordHash = await hashPassword(password);

  for (const seed of TEST_USERS) {
    const [existing] = await db.select().from(users).where(eq(users.email, seed.email));
    if (existing) {
      console.log(`exists  ${seed.email}`);
      continue;
    }
    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ ...seed, emailVerified: true })
        .returning({ id: users.id });
      await tx.insert(accounts).values({
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      });
    });
    console.log(`created ${seed.email} (${seed.role})`);
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
