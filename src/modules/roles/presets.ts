import type { PermissionKey, Role } from "@/lib/permissions";

// Phase 28: what a company gets when it says what kind of team it is. Everything here is a
// suggestion: the company can rename, add or archive titles and change or archive roles later.

export const TEAM_TYPES = ["SOFTWARE", "FINTECH", "OTHER"] as const;
export type TeamType = (typeof TEAM_TYPES)[number];

export const teamTypeLabel: Record<TeamType, string> = {
  SOFTWARE: "Software or app development",
  FINTECH: "Fintech or payments",
  OTHER: "Something else",
};

export type RolePreset = { name: string; description: string; baseRole: Role; permissions: PermissionKey[] };

const softwareTitles = [
  "Project manager",
  "Product owner",
  "Technical lead",
  "UI/UX designer",
  "Frontend developer",
  "Backend developer",
  "Mobile developer",
  "QA tester",
  "DevOps engineer",
];

export const JOB_TITLE_PRESETS: Record<TeamType, string[]> = {
  SOFTWARE: softwareTitles,
  FINTECH: [...softwareTitles, "Security officer", "Compliance officer", "Risk analyst", "Payments operations"],
  OTHER: ["Project manager", "Designer", "Developer", "Writer", "Consultant"],
};

const finance: RolePreset = {
  name: "Finance",
  description: "Pays the team and handles invoices and customer payments. Doesn't edit or approve projects.",
  baseRole: "ADMIN",
  permissions: ["payouts.view", "payouts.pay", "finance", "clients", "invoices", "invoices.payments", "team.view"],
};

const teamLead: RolePreset = {
  name: "Team Lead",
  description: "Runs projects and tasks day to day. Doesn't approve payouts or see money reports.",
  baseRole: "PROJECT_MANAGER",
  permissions: ["projects.manage", "team.view"],
};

const compliance: RolePreset = {
  name: "Compliance",
  description: "Checks the work and the money trail. Sees payouts and the team; changes nothing.",
  baseRole: "PROJECT_MANAGER",
  permissions: ["payouts.view", "team.view"],
};

export const ROLE_PRESETS: Record<TeamType, RolePreset[]> = {
  SOFTWARE: [teamLead, finance],
  FINTECH: [teamLead, finance, compliance],
  OTHER: [teamLead, finance],
};
