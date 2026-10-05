import Link from "next/link";
import { navGroups } from "@/components/nav";
import { AppShell } from "@/components/shell";
import { SignOutButton } from "@/components/sign-out-button";
import { Avatar } from "@/components/ui";
import { roleLabel } from "@/lib/labels";
import { requireUser } from "@/lib/session";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <AppShell
      groups={navGroups(user)}
      user={
        <div className="flex items-center gap-2.5 px-2">
          <Avatar name={user.name} />
          <Link href="/account" className="min-w-0 flex-1 leading-tight hover:opacity-80" title="Account settings">
            <span className="block truncate text-sm font-medium text-fg">{user.name}</span>
            <span className="block truncate text-xs text-muted">{roleLabel[user.role]}</span>
          </Link>
          <SignOutButton />
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
