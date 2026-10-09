import type { Metadata } from "next";
import Link from "next/link";
import { CompanySwitcher } from "@/components/company-switcher";
import { communityGroup, navGroups } from "@/components/nav";
import { AppShell } from "@/components/shell";
import { SignOutButton } from "@/components/sign-out-button";
import { Avatar } from "@/components/ui";
import { PRODUCT_NAME } from "@/lib/brand";
import { roleLabel } from "@/lib/labels";
import { requireMember } from "@/lib/session";
import { canModerate } from "@/modules/community";
import { switchCompanyAction } from "../(authenticated)/company/actions";

// Phase 25: the signed-in community pages, for everyone. People in a company also see their
// company's sections; people without one see only the community.
// Phase 39: signed-in pages are never indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CommunityLayout({ children }: { children: React.ReactNode }) {
  const { member, current } = await requireMember();
  const organizer = await canModerate(member);
  const groups = current ? [...navGroups(current), communityGroup({ organizer })] : [communityGroup({ organizer })];

  return (
    <AppShell
      groups={groups}
      company={current?.orgName ?? PRODUCT_NAME}
      subtitle={current ? "Projects & Payouts" : "Community"}
      homeHref={current ? "/dashboard" : "/community"}
      switcher={current && current.companies.length > 1 ? <CompanySwitcher companies={current.companies} current={current.orgId} action={switchCompanyAction} /> : undefined}
      user={
        <div className="flex items-center gap-2.5 px-2">
          <Avatar name={member.name} />
          <Link href={current ? "/account" : "/community/profile"} className="min-w-0 flex-1 leading-tight hover:opacity-80" title="Your settings">
            <span className="block truncate text-sm font-medium text-fg">{member.name}</span>
            <span className="block truncate text-xs text-muted">{current ? roleLabel[current.role] : organizer ? "Organizer" : "Member"}</span>
          </Link>
          <SignOutButton />
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
