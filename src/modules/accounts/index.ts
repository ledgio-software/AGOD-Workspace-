import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, memberships, users, verifications } from "@/lib/db/schema";
import { type EmailMessage, emailConfig, sendEmail } from "@/lib/email";
import { resolveBaseUrl } from "@/lib/env";
import { createOrganization } from "@/modules/orgs";

// Phase 23: self-service accounts. People sign up with their company's name; the company is
// created when they confirm their email (so an unconfirmed address never gets a company, and
// signing up with someone else's email reveals nothing). Admins invite people by email with a
// link to choose their password, using Better Auth's own password-reset tokens.

/** Sign-up is open when ALLOW_SIGNUP=true and email works (the confirmation email must go out). */
export function signupOpen(source: Record<string, string | undefined> = process.env): boolean {
  return source.ALLOW_SIGNUP?.trim() === "true" && emailConfig(source) !== null;
}

export const appUrl = (path = "") => `${(resolveBaseUrl(process.env) ?? "").replace(/\/$/, "")}${path}`;

/** Sends an account email; false when email isn't set up here. Errors propagate. */
export async function sendAccountEmail(to: string, message: Omit<EmailMessage, "to">): Promise<boolean> {
  const config = emailConfig();
  if (!config) return false;
  await sendEmail(config, { to, ...message });
  return true;
}

/**
 * After someone confirms their email: if they named a company at sign-up and belong to none yet,
 * create it with them as its Admin. Safe to call more than once. Returns the new company's id.
 */
export async function finishSignUp(userId: string): Promise<string | null> {
  const [user] = await db.select({ pendingCompany: users.pendingCompany }).from(users).where(eq(users.id, userId));
  if (!user?.pendingCompany) return null;
  const name = user.pendingCompany;
  await db.update(users).set({ pendingCompany: null }).where(eq(users.id, userId));
  const [already] = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
  if (already) return null;
  try {
    const org = await createOrganization({ name, ownerId: userId });
    await db.insert(auditEvents).values({
      organizationId: org.id,
      actorId: userId,
      entityType: "organization",
      entityId: org.id,
      action: "company.created",
      afterJson: { name: org.name, via: "sign-up" },
    });
    return org.id;
  } catch (error) {
    // An unusable name: they can create the company from the "no company" page instead.
    console.error("Creating the company after sign-up failed", userId, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Seven days for invitations (password-reset links from "Forgot password" last one hour). */
const INVITE_DAYS = 7;

/**
 * A one-time link to choose a password (an invitation), in Better Auth's password-reset format:
 * it opens /api/auth/reset-password/<token>, which forwards to our /reset-password page.
 */
export async function createPasswordLink(userId: string, days = INVITE_DAYS): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.insert(verifications).values({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + days * 86_400_000),
  });
  return appUrl(`/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(appUrl("/reset-password?welcome=1"))}`);
}
