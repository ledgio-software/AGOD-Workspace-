import Link from "next/link";
import { EyeOff } from "lucide-react";
import { Badge } from "@/components/badges";
import { Card, Disclosure, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { myHiddenItems } from "@/modules/safety/appeals";
import { ContentAppealForm } from "./appeal-form";

// Phase 42: a member's hidden posts, and asking AGOD staff to look again (src/modules/safety/appeals.ts).

export const metadata = { title: "My hidden posts" };

export default async function MyHiddenPostsPage() {
  const { member } = await requireMember();
  const items = await myHiddenItems(member);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Community"
        title="My hidden posts"
        description="Things of yours that organizers or AGOD staff hid, and why. If you think one was hidden by mistake, appeal and AGOD staff will look again."
      />
      <Card bodyClassName={items.length ? "p-0" : undefined}>
        {items.length === 0 ? (
          <EmptyState icon={EyeOff} title="Nothing of yours is hidden" />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={`${item.type}:${item.id}`} className="space-y-2 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{item.kind}</Badge>
                  <Link href={item.link} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                    {item.label}
                  </Link>
                  <span className="text-xs text-muted">hidden {formatDateTime(item.hiddenAt)}</span>
                  {item.appeal?.status === "OPEN" && <Badge tone="amber">Appeal waiting</Badge>}
                  {item.appeal?.status === "REJECTED" && <Badge tone="red">Appeal not accepted</Badge>}
                </div>
                {item.reason && <p className="text-muted">Reason: {item.reason}</p>}
                {item.appeal?.status === "REJECTED" && item.appeal.note && <p className="text-muted">AGOD staff: {item.appeal.note}</p>}
                {(!item.appeal || item.appeal.status === "ACCEPTED") && (
                  <Disclosure summary="Appeal">
                    <ContentAppealForm type={item.type} id={item.id} />
                  </Disclosure>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
