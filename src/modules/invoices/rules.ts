import { type BillingCadence, addMonths } from "@/modules/subscriptions/rules";
import { addDays } from "@/modules/notifications/deadlines";

// Pure rules for invoices (Phase 20).

export type InvoiceStatus = "DRAFT" | "ISSUED" | "VOID";
/** What people see: issued invoices are open, partly paid, paid or overdue. */
export type InvoiceState = "DRAFT" | "OPEN" | "PARTLY_PAID" | "PAID" | "OVERDUE" | "VOID";

export function invoiceState(
  i: { status: InvoiceStatus; totalMinor: number; paidMinor: number; dueDate: string | null },
  today: string,
): InvoiceState {
  if (i.status !== "ISSUED") return i.status;
  if (i.totalMinor > 0 && i.paidMinor >= i.totalMinor) return "PAID";
  if (i.dueDate && i.dueDate < today) return "OVERDUE";
  return i.paidMinor > 0 ? "PARTLY_PAID" : "OPEN";
}

export function balanceMinor(i: { status: InvoiceStatus; totalMinor: number; paidMinor: number }): number {
  return i.status === "ISSUED" ? i.totalMinor - i.paidMinor : 0;
}

export function formatInvoiceNumber(year: string, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(4, "0")}`;
}

/**
 * The next period of a subscription to bill: it starts the day after the last billed period
 * (or on the start date) and lasts one billing period, cut at the end date. One-time billing is
 * billed once; custom billing has no fixed period (bill it with a manual line). Null when nothing
 * is left to bill.
 */
export function nextBillingPeriod(s: {
  startDate: string;
  endDate: string | null;
  billingCadence: BillingCadence;
  lastPeriodEnd: string | null;
}): { start: string; end: string } | null {
  if (s.billingCadence === "CUSTOM") return null;
  if (s.billingCadence === "ONE_TIME") return s.lastPeriodEnd ? null : { start: s.startDate, end: s.startDate };
  const start = s.lastPeriodEnd ? addDays(s.lastPeriodEnd, 1) : s.startDate;
  if (s.endDate && start > s.endDate) return null;
  const months = s.billingCadence === "MONTHLY" ? 1 : s.billingCadence === "QUARTERLY" ? 3 : 12;
  let end = addDays(addMonths(start, months), -1);
  if (s.endDate && end > s.endDate) end = s.endDate;
  return { start, end };
}

/** Days overdue before Admins are told too. */
export const INVOICE_ESCALATION_DAYS = 14;

export type InvoiceAlert = {
  recipientId: string;
  type: "invoice.overdue" | "invoice.overdue_escalated";
  title: string;
  message: string;
  invoiceId: string;
  dedupeKey: string;
};

/** Pure: overdue reminders for the customer's account owner, and Admins after two weeks. */
export function invoiceAlerts(
  userId: string,
  isAdmin: boolean,
  invoices: { id: string; number: string; customerName: string; ownerId: string; dueDate: string; balanceMinor: number; balance: string }[],
  today: string,
): InvoiceAlert[] {
  const alerts: InvoiceAlert[] = [];
  for (const i of invoices) {
    if (i.balanceMinor <= 0 || i.dueDate >= today) continue;
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${i.dueDate}T00:00:00Z`)) / 86_400_000);
    if (i.ownerId === userId) {
      alerts.push({
        recipientId: userId,
        type: "invoice.overdue",
        title: `Invoice overdue: ${i.number} (${i.customerName})`,
        message: `${i.balance} was due ${i.dueDate}. Follow up with the customer or record the payment.`,
        invoiceId: i.id,
        dedupeKey: `invoice.overdue:${i.id}:${i.dueDate}`,
      });
    } else if (isAdmin && days >= INVOICE_ESCALATION_DAYS) {
      alerts.push({
        recipientId: userId,
        type: "invoice.overdue_escalated",
        title: `Invoice ${days} days overdue: ${i.number} (${i.customerName})`,
        message: `${i.balance} unpaid since ${i.dueDate}. The account owner has been reminded.`,
        invoiceId: i.id,
        dedupeKey: `invoice.overdue_escalated:${i.id}:${i.dueDate}`,
      });
    }
  }
  return alerts;
}
