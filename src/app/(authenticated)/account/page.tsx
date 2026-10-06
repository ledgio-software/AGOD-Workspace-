import { CircleCheck, CircleX, ExternalLink, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/badges";
import { Avatar, Callout, Card, PageHeader, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { roleLabel } from "@/lib/labels";
import { emailConfig } from "@/lib/email";
import { googleConfig } from "@/lib/google/config";
import { requireUser } from "@/lib/session";
import { personalCalendarStatus } from "@/modules/google/calendar";
import { getDailyEmail } from "@/modules/notifications/preferences";
import { MyCalendarActions } from "./calendar-actions";
import { ChangePasswordForm } from "./change-password-form";
import { DailyEmailForm } from "./email-form";

const googleResult: Record<string, { tone: "good" | "warn" | "bad"; text: string }> = {
  connected: { tone: "good", text: "Google Calendar connected. Your tasks with due dates are in your new calendar." },
  cancelled: { tone: "warn", text: "Connecting was cancelled on Google's screen. Nothing changed." },
  expired: { tone: "bad", text: "That sign-in took too long or was started in another browser. Try again." },
  "no-calendar": { tone: "bad", text: "Calendar access was not allowed. Try again and leave the Calendar box ticked on Google's screen." },
  failed: { tone: "bad", text: "Google refused the connection. Try again in a moment." },
  "not-configured": { tone: "warn", text: "Google isn't set up on this environment yet." },
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const user = await requireUser();
  const [dailyEmail, calendar] = await Promise.all([getDailyEmail(user), personalCalendarStatus(user)]);
  const emailEnabled = emailConfig() !== null;
  const googleReady = googleConfig() !== null;
  const result = googleResult[(await searchParams).google ?? ""];

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
      <Card
        title="Google Calendar"
        description={`Your tasks in ${user.orgName} with due dates, in a calendar of its own in your Google account, kept up to date every morning. Project meeting invitations go to this Google address.`}
      >
        <div className="space-y-3 text-sm">
          {result && (
            <Callout tone={result.tone} icon={result.tone === "good" ? CircleCheck : TriangleAlert}>
              {result.text}
            </Callout>
          )}
          {calendar ? (
            <>
              {calendar.lastError ? (
                <Callout tone="bad" icon={CircleX}>
                  Connected as {calendar.googleEmail}, but the last update failed: {calendar.lastError}
                </Callout>
              ) : (
                <p>
                  Connected as <strong>{calendar.googleEmail}</strong>
                  {calendar.lastSyncAt && <span className="text-muted"> · updated {formatDateTime(calendar.lastSyncAt)}</span>}.
                </p>
              )}
              <div className="flex flex-wrap items-start gap-3">
                {calendar.url && (
                  <a href={calendar.url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
                    Open in Google Calendar <ExternalLink className="size-3.5 opacity-60" aria-hidden />
                  </a>
                )}
                <MyCalendarActions />
              </div>
            </>
          ) : googleReady ? (
            <>
              <p className="text-muted">The app only gets access to the one calendar it creates. It can&apos;t see or change the rest of your Google Calendar.</p>
              <a href="/api/google/connect?kind=personal" className={buttonClass("primary", "sm")}>
                Connect my Google Calendar
              </a>
            </>
          ) : (
            <p className="text-muted">Google isn&apos;t set up on this environment yet.</p>
          )}
        </div>
      </Card>
      <Card title="Change password" description="At least 10 characters. Changing it signs you out on your other devices.">
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
