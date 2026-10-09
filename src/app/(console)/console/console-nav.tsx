"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const TABS = [
  { href: "/console", label: "Overview" },
  { href: "/console/companies", label: "Companies" },
  { href: "/console/people", label: "People" },
  { href: "/console/moderation", label: "Moderation" },
  { href: "/console/content", label: "Content" },
  { href: "/console/log", label: "Log" },
];

export function ConsoleNav() {
  const path = usePathname();
  return (
    <nav aria-label="Back office" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {TABS.map((t) => {
          const active = t.href === "/console" ? path === "/console" : path.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cx("inline-block rounded-lg px-3 py-1.5 text-sm font-medium", active ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white")}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
