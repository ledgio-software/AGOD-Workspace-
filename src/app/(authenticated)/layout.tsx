import Link from "next/link";
import { CompanySwitcher } from "@/components/company-switcher";
import { navGroups } from "@/components/nav";
import { AppShell } from "@/components/shell";
import { SignOutButton } from "@/components/sign-out-button";
import { Avatar } from "@/components/ui";
import { roleLabel } from "@/lib/labels";
import { requireUser } from "@/lib/session";
import { switchCompanyAction } from "./company/actions";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <AppShell
      groups={navGroups(user)}
      company={user.orgName}
      switcher={user.companies.length > 1 ? <CompanySwitcher companies={user.companies} current={user.orgId} action={switchCompanyAction} /> : undefined}
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
