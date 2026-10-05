import type { Role } from "@/lib/permissions";
import type { Health, ProjectStatus, TaskStatus } from "@/modules/projects/rules";

export const roleLabel: Record<Role, string> = {
  TEAM_MEMBER: "Team Member",
  PROJECT_MANAGER: "Project Manager",
  ADMIN: "Admin",
};

export const projectStatusLabel: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  PLANNING: "Planning",
  IN_PROGRESS: "In progress",
  PENDING_APPROVAL: "Pending approval",
  CHANGES_REQUESTED: "Changes requested",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const taskStatusLabel: Record<TaskStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
  WAIVED: "Waived",
};

export const healthLabel: Record<Health, string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  BLOCKED: "Blocked",
  OVERDUE: "Overdue",
};

export const milestoneStatusLabel = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
} as const;

const auditActionLabel: Record<string, string> = {
  "project.created": "created the project",
  "project.updated": "updated project details",
  "project.status_changed": "changed the project status",
  "assignment.added": "added a team member",
  "assignment.updated": "changed a team member's role or split",
  "assignment.removed": "removed a team member",
  "milestone.created": "added a milestone",
  "milestone.status_changed": "changed a milestone status",
  "project.approval_requested": "requested approval",
  "project.approved": "approved the project and created payouts",
  "project.changes_requested": "returned the project for changes",
  "project.reopened": "reopened the project and voided its payouts",
  "payment.recorded": "recorded a payment",
  "adjustment.created": "adjusted a payout",
  "task.created": "added a task",
  "task.updated": "edited a task",
  "task.progress_updated": "updated task progress",
  "task.waived": "waived a task",
  "user.created": "added a team member account",
  "user.role_changed": "changed a role",
  "user.deactivated": "deactivated an account",
  "user.reactivated": "reactivated an account",
  "user.password_reset": "reset a password",
};

export function describeAuditAction(action: string): string {
  return auditActionLabel[action] ?? action;
}

export const payoutStatusLabel = {
  OWED: "Owed",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  DISPUTED: "Disputed",
  VOIDED: "Voided",
} as const;

export const paymentMethodLabel = {
  MOBILE_MONEY: "Mobile Money",
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  OTHER: "Other",
} as const;

export const adjustmentTypeLabel = {
  INCREASE: "Increase",
  DECREASE: "Decrease",
  WRITE_OFF: "Write-off",
  VOID: "Void",
} as const;
