import type { Metadata } from "next";
import Link from "next/link";
import { CompanySwitcher } from "@/components/company-switcher";
import { communityGroup, navGroups } from "@/components/nav";
import { AppShell } from "@/components/shell";
import { SignOutButton } from "@/components/sign-out-button";
import { Avatar } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { MessagesLink } from "@/components/messages-link";
import { canModerate } from "@/modules/community";
import { unreadMessageCount } from "@/modules/messages";
import { switchCompanyAction } from "./company/actions";

// Phase 39: signed-in pages are never indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [organizer, unread] = await Promise.all([canModerate(user), unreadMessageCount(user)]);

  return (
    <AppShell
      groups={[...navGroups(user), communityGroup({ organizer })]}
      company={user.orgName}
      messages={<MessagesLink initial={unread} />}
      switcher={user.companies.length > 1 ? <CompanySwitcher companies={user.companies} current={user.orgId} action={switchCompanyAction} /> : undefined}
      user={
        <div className="flex items-center gap-2.5 px-2">
          <Avatar name={user.name} />
          <Link href="/account" className="min-w-0 flex-1 leading-tight hover:opacity-80" title="Account settings">
            <span className="block truncate text-sm font-medium text-fg">{user.name}</span>
            <span className="block truncate text-xs text-muted">{user.roleName}</span>
          </Link>
          <SignOutButton />
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
