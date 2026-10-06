import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resolveBaseUrl } from "@/lib/env";
import * as schema from "@/lib/db/schema";
import { appUrl, finishSignUp, sendAccountEmail } from "@/modules/accounts";
import { existingSignUpMessage, resetPasswordMessage, verifyEmailMessage } from "@/modules/email/account";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: resolveBaseUrl(process.env),
  database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
  advanced: { database: { generateId: "uuid" } },
  emailAndPassword: {
    enabled: true,
    // Phase 23: anyone may sign up (and create a company) when ALLOW_SIGNUP=true; otherwise
    // accounts come from Admins' invitations and the admin:create script only.
    disableSignUp: process.env.ALLOW_SIGNUP?.trim() !== "true",
    // Self-registered people confirm their email before they can sign in. (Invited people and
    // accounts made by scripts are created confirmed.)
    requireEmailVerification: true,
    minPasswordLength: 10,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAccountEmail(user.email, resetPasswordMessage({ name: user.name, url }));
    },
    // Signing up with an address that already has a login reveals nothing; its owner is told.
    onExistingUserSignUp: async ({ user }) => {
      await sendAccountEmail(user.email, existingSignUpMessage({ name: user.name, signInUrl: appUrl("/sign-in"), resetUrl: appUrl("/forgot-password") }));
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 24 * 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAccountEmail(user.email, verifyEmailMessage({ name: user.name, url }));
    },
    afterEmailVerification: async (user) => {
      await finishSignUp(user.id);
    },
  },
  user: {
    additionalFields: {
      active: { type: "boolean", input: false, defaultValue: true },
      phone: { type: "string", required: false, input: false },
      // The company to create once the email is confirmed (sign-up form).
      pendingCompany: { type: "string", required: false, input: true },
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 60, max: 5 },
      "/request-password-reset": { window: 60 * 60, max: 5 },
      "/send-verification-email": { window: 60 * 60, max: 5 },
      "/reset-password": { window: 60, max: 5 },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const raw = (user as { pendingCompany?: unknown }).pendingCompany;
          if (raw === undefined || raw === null) return { data: user };
          const name = String(raw).trim();
          if (name.length < 2 || name.length > 120) {
            throw new APIError("BAD_REQUEST", { message: "Give your company a name (2 to 120 characters)." });
          }
          return { data: { ...user, pendingCompany: name } };
        },
      },
    },
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
