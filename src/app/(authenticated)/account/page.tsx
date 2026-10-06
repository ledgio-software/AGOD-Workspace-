import { Badge } from "@/components/badges";
import { Avatar, Card, PageHeader } from "@/components/ui";
import { roleLabel } from "@/lib/labels";
import { emailConfig } from "@/lib/email";
import { requireUser } from "@/lib/session";
import { getDailyEmail } from "@/modules/notifications/preferences";
import { ChangePasswordForm } from "./change-password-form";
import { DailyEmailForm } from "./email-form";

export default async function AccountPage() {
  const user = await requireUser();
  const dailyEmail = await getDailyEmail(user);
  const emailEnabled = emailConfig() !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader eyebrow="Account" title="Your account" />
      <Card>
        <div className="flex items-center gap-4">
          <Avatar name={user.name} />
          <div className="min-w-0">
            <p className="font-semibold">{user.name}</p>
            <p className="truncate text-sm text-muted">{user.email}</p>
          </div>
          <span className="ml-auto">
            <Badge tone="blue">{roleLabel[user.role]}</Badge>
          </span>
        </div>
      </Card>
      <Card
        title="Email"
        description={`Once a day, an email to ${user.email} listing what's new for you (tasks, approvals, payouts, renewals). Nothing is sent on days without news.`}
      >
        <DailyEmailForm on={dailyEmail} />
        {!emailEnabled && <p className="mt-3 text-xs text-muted">Email isn&apos;t set up on this environment yet, so nothing is sent for now.</p>}
      </Card>
      <Card title="Change password" description="At least 10 characters. Changing it signs you out on your other devices.">
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
