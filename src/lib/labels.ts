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
  IN_REVIEW: "In review",
  READY_FOR_QA: "Ready for QA",
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
  "project.health_overridden": "overrode the project health",
  "project.health_override_cleared": "cleared the health override",
  "payout_question.raised": "asked a question about a payout",
  "payout_question.reviewed": "reviewed a payout question",
  "payout_question.resolved": "resolved a payout question",
  "period.closed": "closed a payout month",
  "period.reopened": "reopened a payout month",
  "project.template_applied": "added milestones and tasks from a template",
  "template.created": "created a template",
  "template.updated": "updated a template",
  "user.capacity_changed": "changed weekly capacity",
  "project.github_repo_set": "connected the GitHub repository",
  "task.github_linked": "linked a GitHub item to a task",
  "task.github_unlinked": "removed a GitHub link from a task",
  "task.github_issue_created": "created a GitHub issue for a task",
  "attachment.uploaded": "uploaded a file",
  "attachment.removed": "removed a file",
  "project.finance_updated": "changed the project type or cost budget",
  "cost.recorded": "recorded a project cost",
  "cost.voided": "voided a project cost",
};

export const projectCategoryLabel = {
  DISCOVERY: "Discovery / research",
  WEBSITE: "Website",
  MOBILE_APP: "Mobile app",
  AI_INTEGRATION: "AI integration",
  INTERNAL_PRODUCT: "Internal product feature",
  MAINTENANCE: "Maintenance / support",
  OTHER: "Other",
} as const;

export const costCategoryLabel = {
  SOFTWARE: "Software / licences",
  HOSTING: "Hosting / cloud",
  HARDWARE: "Hardware",
  SUBCONTRACTOR: "Subcontractor",
  TRAVEL: "Travel",
  MARKETING: "Marketing",
  OTHER: "Other",
} as const;

export const payoutQuestionStatusLabel = {
  OPEN: "Waiting for PM review",
  AWAITING_ADMIN: "Waiting for Admin",
  RESOLVED: "Resolved",
} as const;

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
