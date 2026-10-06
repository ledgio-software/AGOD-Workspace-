import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resolveBaseUrl } from "@/lib/env";
import * as schema from "@/lib/db/schema";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: resolveBaseUrl(process.env),
  database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
  advanced: { database: { generateId: "uuid" } },
  emailAndPassword: {
    enabled: true,
    // Internal tool: accounts are created by an Admin (or the dev seed), never self-registered.
    disableSignUp: true,
    minPasswordLength: 10,
  },
  user: {
    additionalFields: {
      active: { type: "boolean", input: false, defaultValue: true },
      phone: { type: "string", required: false, input: false },
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Inactive members cannot start a session.
        before: async (session) => {
          const [user] = await db
            .select({ active: schema.users.active })
            .from(schema.users)
            .where(eq(schema.users.id, session.userId));
          return user?.active ? undefined : false;
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
