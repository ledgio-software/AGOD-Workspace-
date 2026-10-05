import Link from "next/link";
import { type Actor, can } from "@/lib/permissions";

export function Nav({ actor }: { actor: Actor }) {
  const links = [
    { href: "/dashboard", label: "Dashboard", show: true },
    { href: "/my-work", label: "My work", show: true },
    { href: "/projects", label: "Projects", show: true },
    { href: "/ledger", label: "Ledger", show: can(actor, "payout.viewAll") },
    { href: "/questions", label: "Questions", show: can(actor, "payoutQuestion.review") },
    { href: "/close", label: "Month close", show: can(actor, "period.view") },
    { href: "/team", label: "Team", show: can(actor, "team.view") },
    { href: "/workload", label: "Workload", show: can(actor, "workload.view") },
    { href: "/summary", label: "Weekly", show: can(actor, "report.weekly") },
    { href: "/audit", label: "Audit", show: can(actor, "audit.viewProject") },
    { href: "/account", label: "Account", show: true },
  ];

  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {links
        .filter((link) => link.show)
        .map((link) => (
          <Link key={link.href} href={link.href} className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            {link.label}
          </Link>
        ))}
    </nav>
  );
}
