import { type Actor, can } from "@/lib/permissions";
import type { IconName } from "./shell";

export type NavItem = { href: string; label: string; icon: IconName };
export type NavGroup = { label: string; items: NavItem[] };

/** The sidebar sections a person can see. The pages check access again; this only hides links. */
export function navGroups(actor: Actor): NavGroup[] {
  const groups: { label: string; items: (NavItem & { show: boolean })[] }[] = [
    {
      label: "Overview",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "dashboard", show: true },
        { href: "/my-work", label: "My work", icon: "myWork", show: true },
      ],
    },
    {
      label: "Work",
      items: [
        { href: "/projects", label: "Projects", icon: "projects", show: true },
        { href: "/workload", label: "Workload", icon: "workload", show: can(actor, "workload.view") },
        { href: "/summary", label: "Weekly summary", icon: "weekly", show: can(actor, "report.weekly") },
      ],
    },
    {
      label: "Customers",
      items: [
        { href: "/customers", label: "Customers", icon: "customers", show: can(actor, "customer.view") },
        { href: "/subscriptions", label: "Subscriptions", icon: "subscriptions", show: can(actor, "subscription.view") },
        { href: "/services", label: "Services", icon: "services", show: can(actor, "subscription.view") },
      ],
    },
    {
      label: "Money",
      items: [
        { href: "/invoices", label: "Invoices", icon: "invoices", show: can(actor, "invoice.view") },
        { href: "/ledger", label: "Ledger", icon: "ledger", show: can(actor, "payout.viewAll") },
        { href: "/questions", label: "Questions", icon: "questions", show: can(actor, "payoutQuestion.review") },
        { href: "/close", label: "Month close", icon: "close", show: can(actor, "period.view") },
        { href: "/profitability", label: "Profitability", icon: "profitability", show: can(actor, "finance.view") },
      ],
    },
    {
      label: "Team & admin",
      items: [
        { href: "/team", label: "Team", icon: "team", show: can(actor, "team.view") },
        { href: "/audit", label: "Audit log", icon: "audit", show: can(actor, "audit.viewProject") },
        { href: "/integrations", label: "Integrations", icon: "integrations", show: can(actor, "audit.viewAll") },
      ],
    },
  ];
  return groups
    .map((g) => ({ label: g.label, items: g.items.filter((i) => i.show).map(({ href, label, icon }) => ({ href, label, icon })) }))
    .filter((g) => g.items.length > 0);
}
