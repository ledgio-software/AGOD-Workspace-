import type { Role } from "@/lib/permissions";

export const roleLabel: Record<Role, string> = {
  TEAM_MEMBER: "Team Member",
  PROJECT_MANAGER: "Project Manager",
  ADMIN: "Admin",
};
