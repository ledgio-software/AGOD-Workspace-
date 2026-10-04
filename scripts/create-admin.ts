// Creates the FIRST Admin in an environment that has none (e.g. production at go-live).
// Refuses to run if an active Admin already exists: after that, Admins are managed on the Team page.
//
//   ADMIN_NAME="Ama Mensah" ADMIN_EMAIL=ama@example.com npm run admin:create
//
// Prints a temporary password once. The Admin must change it on the Account page after signing in.
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { normalizeDatabaseUrl } from "../src/lib/db/url";
import { accounts, auditEvents, users } from "../src/lib/db/schema";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const url = process.env.DATABASE_URL;
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!name || !email || !email.includes("@")) {
    throw new Error("Set ADMIN_NAME and ADMIN_EMAIL.");
  }

  const pool = new Pool({ connectionString: normalizeDatabaseUrl(url) });
  const db = drizzle(pool);
  try {
    const [existingAdmin] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "ADMIN"), eq(users.active, true)));
    if (existingAdmin) {
      throw new Error("An active Admin already exists. Use the Team page to add more Admins.");
    }
    const [existingEmail] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email));
    if (existingEmail) throw new Error("A user with this email already exists.");

    const temporaryPassword = `Agod-${randomBytes(12).toString("base64url")}`;
    const passwordHash = await hashPassword(temporaryPassword);
    await db.transaction(async (tx) => {
      const [admin] = await tx
        .insert(users)
        .values({ name, email, role: "ADMIN", emailVerified: true })
        .returning({ id: users.id });
      await tx.insert(accounts).values({
        userId: admin.id,
        accountId: admin.id,
        providerId: "credential",
        password: passwordHash,
      });
      await tx.insert(auditEvents).values({
        actorId: null,
        entityType: "user",
        entityId: admin.id,
        action: "user.bootstrap_admin",
        afterJson: { name, email, role: "ADMIN" },
      });
    });
    console.log(`Created Admin ${email}`);
    console.log(`Temporary password (shown once, change it after signing in): ${temporaryPassword}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
