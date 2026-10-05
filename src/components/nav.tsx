import Link from "next/link";
import { type Actor, can } from "@/lib/permissions";

export function Nav({ actor }: { actor: Actor }) {
  const links = [
    { href: "/dashboard", label: "Dashboard", show: true },
    { href: "/my-work", label: "My work", show: true },
    { href: "/projects", label: "Projects", show: true },
    { href: "/team", label: "Team", show: can(actor, "team.view") },
    { href: "/account", label: "Account", show: true },
  ];

  return (
    <nav className="flex items-center gap-4 text-sm">
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
