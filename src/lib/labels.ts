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
  "customer.created": "added the customer",
  "customer.updated": "edited the customer",
  "customer.archived": "archived the customer",
  "customer.restored": "restored the customer",
  "contact.added": "added a contact",
  "contact.updated": "edited a contact",
  "contact.deactivated": "deactivated a contact",
  "contact.reactivated": "reactivated a contact",
  "service.created": "added the service",
  "service.updated": "edited the service",
  "service.retired": "retired the service",
  "service.reactivated": "offered the service again",
  "subscription.created": "created the subscription",
  "subscription.updated": "edited the subscription",
  "subscription.amended": "amended the terms",
  "subscription.renewed": "renewed the subscription",
  "invoice.created": "created the invoice draft",
  "invoice.updated": "edited the invoice",
  "invoice.line_added": "added an invoice line",
  "invoice.line_removed": "removed an invoice line",
  "invoice.draft_deleted": "deleted the draft",
  "invoice.issued": "issued the invoice",
  "invoice.voided": "voided the invoice",
  "invoice.sent": "emailed the invoice",
  "invoice.payment_recorded": "recorded a payment",
  "invoice.payment_voided": "voided a payment",
  "invoice.settings_updated": "changed the invoice settings",
  "user.daily_email_on": "turned the daily email on",
  "user.daily_email_off": "turned the daily email off",
  "subscription.status_changed": "changed the status",
};

export const billingCadenceLabel = {
  ONE_TIME: "One-time",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
  CUSTOM: "Custom",
} as const;

/** "per month" style suffix for prices. */
export const billingCadenceSuffix = {
  ONE_TIME: "once",
  MONTHLY: "/ month",
  QUARTERLY: "/ quarter",
  ANNUAL: "/ year",
  CUSTOM: "(custom)",
} as const;

export const pricingBasisLabel = {
  FIXED: "Fixed fee",
  PER_SEAT: "Per seat / unit",
  USAGE: "Usage-based",
  OTHER: "Other",
} as const;

export const subscriptionStatusLabel = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  ENDED: "Ended",
  CANCELLED: "Cancelled",
} as const;

/** Human names for amended terms. */
export const subscriptionTermLabel: Record<string, string> = {
  priceMinor: "Price",
  quantity: "Quantity",
  billingCadence: "Billing",
  pricingBasis: "Pricing basis",
  endDate: "End date",
  renewalDate: "Renewal date",
  noticePeriodDays: "Notice period (days)",
  paymentTerms: "Payment terms",
};

export const customerTypeLabel = {
  COMPANY: "Company",
  PERSON: "Individual",
  PARTNER: "Partner",
  OTHER: "Other",
} as const;

export const customerStatusLabel = {
  PROSPECT: "Prospect",
  ACTIVE: "Active",
  PAUSED: "Paused",
  CHURNED: "Churned",
  ARCHIVED: "Archived",
} as const;

export const contactChannelLabel = {
  EMAIL: "Email",
  PHONE: "Phone",
  WHATSAPP: "WhatsApp",
  OTHER: "Other",
} as const;

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

export const invoiceStateLabel = {
  DRAFT: "Draft",
  OPEN: "Open",
  PARTLY_PAID: "Partly paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
} as const;
