import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { companyRoles, memberships, organizations } from "@/lib/db/schema";
import { roleLabel } from "@/lib/labels";
import type { PermissionKey, Role } from "@/lib/permissions";

/** The company a person is working in, remembered per browser (Phase 22). */
export const COMPANY_COOKIE = "gvcd_company";

export type Company = { id: string; name: string; releaseControl: boolean; role: Role; companyRoleId: string | null; joinedAt: Date };

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  /** Role in the current company (for a company-made role: the role it starts from). */
  role: Role;
  /** Phase 28: the permission groups a company-made role keeps; null for a built-in role. */
  permissions: PermissionKey[] | null;
  /** The role's name as the company calls it. */
  roleName: string;
  orgId: string;
  orgName: string;
  /** Phase 32: whether the current company has release approvals switched on (for the menu). */
  releaseControl: boolean;
  /** Every company this person is an active member of (for the switcher). */
  companies: Company[];
};

type SignedIn = { id: string; name: string; email: string };

/** The signed-in, active login for this request, or null. Cached per request. */
export const getSignedIn = cache(async (): Promise<SignedIn | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !session.user.active) return null;
  const { id, name, email } = session.user;
  return { id, name, email };
});

/** The companies a person is an active member of, by name. */
export async function companiesOf(userId: string): Promise<Company[]> {
  return db
    .select({ id: organizations.id, name: organizations.name, releaseControl: organizations.releaseControl, role: memberships.role, companyRoleId: memberships.companyRoleId, joinedAt: memberships.createdAt })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.userId, userId), eq(memberships.active, true)))
    .orderBy(asc(organizations.name));
}

/**
 * The signed-in person in their current company (the remembered one if they are still an active
 * member there, else the one they joined first), or null when signed out or not in any company.
 * Cached per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const user = await getSignedIn();
  if (!user) return null;
  const companies = await companiesOf(user.id);
  if (companies.length === 0) return null;
  const remembered = (await cookies()).get(COMPANY_COOKIE)?.value;
  const first = companies.reduce((a, b) => (b.joinedAt < a.joinedAt ? b : a));
  const current = companies.find((c) => c.id === remembered) ?? first;
  let permissions: PermissionKey[] | null = null;
  let roleName = roleLabel[current.role];
  if (current.companyRoleId) {
    const [custom] = await db
      .select({ name: companyRoles.name, permissions: companyRoles.permissions })
      .from(companyRoles)
      .where(and(eq(companyRoles.id, current.companyRoleId), eq(companyRoles.organizationId, current.id)));
    // A missing role would be a bug; fail closed with no extra permissions.
    permissions = (custom?.permissions ?? []) as PermissionKey[];
    roleName = custom?.name ?? roleName;
  }
  return { ...user, role: current.role, permissions, roleName, orgId: current.id, orgName: current.name, releaseControl: current.releaseControl, companies };
});

/**
 * Use in server components/actions that require a signed-in person working in a company. People
 * without a company (Phase 25: community members) go to the community instead.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) return user;
  if (await getSignedIn()) redirect("/community");
  redirect("/sign-in");
}

/** Phase 25: the community pages: any signed-in person, with their company if they have one. */
export async function requireMember(): Promise<{ member: SignedIn; current: CurrentUser | null }> {
  const member = await getSignedIn();
  if (!member) redirect("/sign-in");
  return { member, current: await getCurrentUser() };
}
