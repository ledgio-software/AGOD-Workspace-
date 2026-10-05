"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarCheck,
  CircleHelp,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Menu,
  Newspaper,
  Plug,
  ScrollText,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { NavGroup } from "./nav";
import { cx } from "./ui";

const icons = {
  dashboard: LayoutDashboard,
  myWork: ListChecks,
  projects: FolderKanban,
  workload: Gauge,
  weekly: Newspaper,
  ledger: Wallet,
  questions: CircleHelp,
  close: CalendarCheck,
  profitability: TrendingUp,
  team: Users,
  audit: ScrollText,
  integrations: Plug,
} as const;

export type IconName = keyof typeof icons;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
      <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white shadow-sm">A</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-fg">AGOD</span>
        <span className="block text-[11px] text-muted">Projects &amp; Payouts</span>
      </span>
    </Link>
  );
}

function SidebarNav({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
  return (
    <nav aria-label="Main" className="space-y-6">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{group.label}</div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = icons[item.icon];
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition",
                      active
                        ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/60 dark:text-brand-300"
                        : "text-muted hover:bg-surface-muted hover:text-fg",
                    )}
                  >
                    <Icon className={cx("size-4 shrink-0", active ? "text-brand-600 dark:text-brand-400" : "")} aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The signed-in layout: sidebar on large screens, a top bar with a slide-in menu on small ones. */
export function AppShell({ groups, user, children }: { groups: NavGroup[]; user: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    // Close the mobile menu after navigating.
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sidebar = (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      <Brand />
      <div className="flex-1 overflow-y-auto">
        <SidebarNav groups={groups} pathname={pathname} />
      </div>
      <div className="border-t border-line pt-4">{user}</div>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-1">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-sidebar lg:block print:hidden">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-72 max-w-[85%] border-r border-line bg-sidebar shadow-xl">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-5 rounded-lg p-1.5 text-muted hover:bg-surface-muted"
            >
              <X className="size-5" aria-hidden />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden print:hidden">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-muted"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <Brand />
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
