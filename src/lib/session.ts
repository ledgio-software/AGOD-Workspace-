import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type UserRole = "TEAM_MEMBER" | "PROJECT_MANAGER" | "ADMIN";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

/** The signed-in, active user for this request, or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !session.user.active) return null;
  const { id, name, email, role } = session.user;
  return { id, name, email, role: role as UserRole };
}

/** Use in server components/actions that require a signed-in user. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}
