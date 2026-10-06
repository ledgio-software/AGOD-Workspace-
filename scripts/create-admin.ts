// Creates a company and its first Admin (e.g. production at go-live, or a company you set up by
// hand before self sign-up exists). After that, Admins manage their people on the Team page.
//
//   COMPANY_NAME="AGOD" ADMIN_NAME="Ama Mensah" ADMIN_EMAIL=ama@example.com npm run admin:create
//   (optional: PROJECT_CODE_PREFIX=AGOD — defaults to the first word of the company name)
//
// If the email already has a login (e.g. in another company), that person becomes the new
// company's Admin with their existing password. Otherwise a temporary password is printed once.
import { randomBytes } from "node:crypto";
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const { hashPassword } = await import("better-auth/crypto");
  const { eq, sql } = await import("drizzle-orm");
  const { db } = await import("../src/lib/db");
  const { accounts, auditEvents, organizations, users } = await import("../src/lib/db/schema");
  const { createOrganization } = await import("../src/modules/orgs");

  const company = process.env.COMPANY_NAME?.trim();
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!company || !name || !email || !email.includes("@")) throw new Error("Set COMPANY_NAME, ADMIN_NAME and ADMIN_EMAIL.");

  const [sameName] = await db.select({ id: organizations.id }).from(organizations).where(eq(sql`lower(${organizations.name})`, company.toLowerCase()));
  if (sameName) throw new Error(`A company called "${company}" already exists. Its Admins add people on the Team page.`);

  let temporaryPassword: string | null = null;
  let [user] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email));
  if (!user) {
    temporaryPassword = `Agod-${randomBytes(12).toString("base64url")}`;
    const passwordHash = await hashPassword(temporaryPassword);
    user = await db.transaction(async (tx) => {
      const [created] = await tx.insert(users).values({ name, email, emailVerified: true }).returning({ id: users.id });
      await tx.insert(accounts).values({ userId: created.id, accountId: created.id, providerId: "credential", password: passwordHash });
      return created;
    });
  }
  const org = await createOrganization({ name: company, ownerId: user.id, projectCodePrefix: process.env.PROJECT_CODE_PREFIX?.trim() || undefined });
  await db.insert(auditEvents).values({
    organizationId: org.id,
    actorId: null,
    entityType: "organization",
    entityId: org.id,
    action: "company.created",
    afterJson: { name: org.name, admin: email },
  });
  console.log(`Created company "${org.name}" (projects ${org.projectCodePrefix}-…) with Admin ${email}`);
  if (temporaryPassword) console.log(`Temporary password (shown once, change it after signing in): ${temporaryPassword}`);
  else console.log("That email already had a login: sign in with its existing password and pick the company.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
