import { CalendarClock, CircleCheck, CircleX, ExternalLink, FolderOpen, HardDrive, Mail, Plug, TriangleAlert, Webhook } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/badges";
import { Callout, Card, EmptyState, PageHeader, buttonClass, compactTable as ct, table } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { describeEmail, emailConfig } from "@/lib/email";
import { resolveBaseUrl } from "@/lib/env";
import { checkGithubApp, githubConfig } from "@/lib/github/app";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { recentDeliveries } from "@/modules/github";
import { googleStatus } from "@/modules/google";
import { type DailySummary, recentJobRuns } from "@/modules/jobs/daily";
import { EmailActions } from "./email-actions";
import { GoogleActions } from "./google-actions";

const googleResult: Record<string, { tone: "good" | "warn" | "bad"; text: string }> = {
  connected: { tone: "good", text: "Google connected. The company folder was created in its Drive and shared with the managers." },
  cancelled: { tone: "warn", text: "Connecting Google was cancelled on Google's screen. Nothing changed." },
  expired: { tone: "bad", text: "That sign-in took too long or was started in another browser. Try again." },
  "no-drive": { tone: "bad", text: "Google Drive access was not allowed. Try again and leave the Drive box ticked on Google's screen." },
  failed: { tone: "bad", text: "Google refused the connection. Try again; if it keeps failing, check the redirect URI and enabled APIs (docs/GOOGLE.md)." },
  "not-configured": { tone: "warn", text: "Google is not set up on this environment yet (see below)." },
};

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "audit.viewAll")) return <AccessDenied what="integration settings" />;
  const config = githubConfig();
  const [check, deliveries, runs, google] = await Promise.all([config ? checkGithubApp() : null, recentDeliveries(actor), recentJobRuns(actor), googleStatus(actor)]);
  const result = googleResult[(await searchParams).google ?? ""];
  const g = google.connection;
  const email = emailConfig();
  const cronReady = (process.env.CRON_SECRET?.length ?? 0) >= 16;
  const webhookUrl = `${resolveBaseUrl(process.env) ?? ""}/api/github/webhook`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Team & admin"
        title="Integrations"
        description={
          <>
            Daily email reminders, Google Drive, and GitHub (links tasks to issues and pull requests and records deployments). Setup guides:{" "}
            <code className="rounded bg-surface-muted px-1 text-xs">docs/EMAIL.md</code>,{" "}
            <code className="rounded bg-surface-muted px-1 text-xs">docs/GOOGLE.md</code> and{" "}
            <code className="rounded bg-surface-muted px-1 text-xs">docs/GITHUB_APP.md</code>.
          </>
        }
      />

      <Card title="Email reminders" aside={<Mail className="size-4 text-muted" aria-hidden />}>
        <div className="space-y-4 text-sm">
          {email?.provider === "smtp" ? (
            <Callout tone="good" icon={CircleCheck}>
              Sending through {describeEmail(email)} as {email.from}.
            </Callout>
          ) : email?.provider === "outbox" ? (
            <Callout tone="info" icon={Mail}>
              Local test mode: emails are written to {email.dir} instead of being sent.
            </Callout>
          ) : (
            <Callout tone="warn" icon={TriangleAlert}>
              Not set up. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and EMAIL_FROM (your mail provider&apos;s SMTP settings) to this environment in Vercel, then redeploy. Setup steps: <code className="text-xs">docs/EMAIL.md</code>.
            </Callout>
          )}
          {!cronReady && (
            <Callout tone="warn" icon={CalendarClock}>
              The daily schedule needs CRON_SECRET (at least 16 random characters) in Vercel. Until then, reminders are only created when people open the app.
            </Callout>
          )}
          <p className="text-muted">
            Every morning at 06:00 (Accra), the app creates everyone&apos;s task, approval and renewal reminders and emails each person one summary of what is new. People can turn the email off on their Account page.
          </p>
          <EmailActions canSend={email !== null} />
        </div>
      </Card>

      <Card title="Google Drive" aside={<HardDrive className="size-4 text-muted" aria-hidden />}>
        <div className="space-y-4 text-sm">
          {result && (
            <Callout tone={result.tone} icon={result.tone === "good" ? CircleCheck : TriangleAlert}>
              {result.text}
            </Callout>
          )}
          {!google.configured ? (
            <Callout tone="warn" icon={TriangleAlert}>
              Not set up. Create a Google OAuth client, add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to this environment in Vercel, then redeploy. Setup steps:{" "}
              <code className="text-xs">docs/GOOGLE.md</code>.
            </Callout>
          ) : !g ? (
            <>
              <p className="text-muted">
                Connect the team&apos;s Google account (for example your company Gmail). The app then keeps a <strong className="text-fg">{actor.orgName}</strong> folder in its Drive with a
                folder per customer and project, saves uploads and issued invoices there, and shares each project folder with its team.
              </p>
              <a href="/api/google/connect" className={buttonClass("primary", "sm")}>
                Connect Google
              </a>
            </>
          ) : (
            <>
              {g.lastError ? (
                <Callout tone="bad" icon={CircleX}>
                  Connected as {g.googleEmail}, but the last call failed{g.lastErrorAt && <> ({formatDateTime(g.lastErrorAt)})</>}: {g.lastError}
                </Callout>
              ) : (
                <Callout tone="good" icon={CircleCheck}>
                  Connected as {g.googleEmail}
                  {g.connectedBy && <> by {g.connectedBy}</>} on {formatDateTime(g.connectedAt)}.
                </Callout>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {g.rootUrl && (
                  <a href={g.rootUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
                    <FolderOpen className="size-4" aria-hidden /> Open the company folder <ExternalLink className="size-3.5 opacity-60" aria-hidden />
                  </a>
                )}
                <a href="/api/google/connect" className={buttonClass("secondary", "sm")}>
                  Reconnect
                </a>
              </div>
              <p className="text-muted">
                {g.lastSyncAt ? (
                  <>
                    Folders and sharing last checked {formatDateTime(g.lastSyncAt)}
                    {g.lastSync && (
                      <>
                        {" "}
                        ({g.lastSync.folders} folders, {g.lastSync.shared} shares added, {g.lastSync.unshared} removed)
                      </>
                    )}
                    . This runs every morning with the reminders.
                  </>
                ) : (
                  "Folders and sharing are checked every morning with the reminders."
                )}
              </p>
              {g.lastSync && g.lastSync.failures.length > 0 && (
                <Callout tone="warn" icon={TriangleAlert}>
                  <p className="font-medium">Some folders could not be shared:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                    {g.lastSync.failures.map((f) => (
                      <li key={f} className="break-words">
                        {f}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs">Drive can only share with Google accounts. People who sign in with another email need a Google account with that address (or will connect their own Google account in a later update).</p>
                </Callout>
              )}
              <GoogleActions />
            </>
          )}
          {google.configured && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted">Authorized redirect URI for this environment</p>
              <code className="block select-all break-all rounded-lg border border-line bg-surface-muted px-3 py-2 font-mono text-xs">{google.redirectUri}</code>
            </div>
          )}
        </div>
      </Card>

      <Card title="Recent daily runs" aside={<CalendarClock className="size-4 text-muted" aria-hidden />} bodyClassName={runs.length ? "p-0" : undefined}>
        {runs.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No runs yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={ct.th}>Started</th>
                  <th className={ct.th}>Result</th>
                  <th className={`${ct.th} text-right`}>Reminders</th>
                  <th className={`${ct.th} text-right`}>Emails sent</th>
                  <th className={ct.th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const s = r.summary as DailySummary | null;
                  return (
                    <tr key={r.id} className={`${table.row} align-top`}>
                      <td className={`${ct.td} whitespace-nowrap text-muted`}>{formatDateTime(r.startedAt)}</td>
                      <td className={ct.td}>
                        {r.ok === null ? <Badge>Running</Badge> : r.ok ? <Badge tone="green">OK</Badge> : <Badge tone="red">Problems</Badge>}
                      </td>
                      <td className={ct.num}>{s?.remindersCreated ?? "—"}</td>
                      <td className={ct.num}>{s ? (s.email === "off" ? "Email off" : s.emailsSent) : "—"}</td>
                      <td className={`${ct.td} text-muted`}>
                        {r.error ??
                          [
                            s?.reminderFailures ? `${s.reminderFailures} reminder failures` : null,
                            s?.emailFailures ? `${s.emailFailures} emails failed (they will be retried)` : null,
                            s?.emailsSkipped ? `${s.emailsSkipped} people turned email off` : null,
                            s?.drive && "error" in s.drive ? `Drive: ${s.drive.error}` : null,
                            s?.drive && "failures" in s.drive && s.drive.failures ? `Drive: ${s.drive.failures} sharing problems` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="GitHub integration" aside={<Plug className="size-4 text-muted" aria-hidden />}>
        <div className="space-y-4 text-sm">
          {!config ? (
            <Callout tone="warn" icon={TriangleAlert}>
              Not set up. Add GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET to this environment in Vercel, then redeploy.
            </Callout>
          ) : check?.ok ? (
            <Callout tone="good" icon={CircleCheck}>
              Connected as the GitHub App “{check.name}”{check.owner && ` owned by ${check.owner}`}.
            </Callout>
          ) : (
            <Callout tone="bad" icon={CircleX}>
              Configured, but GitHub refused the app: {check?.error}
            </Callout>
          )}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted">Webhook URL for this environment</p>
            <code className="block select-all break-all rounded-lg border border-line bg-surface-muted px-3 py-2 font-mono text-xs">{webhookUrl}</code>
          </div>
        </div>
      </Card>

      <Card title="Recent webhook deliveries" aside={<Webhook className="size-4 text-muted" aria-hidden />} bodyClassName={deliveries.length ? "p-0" : undefined}>
        {deliveries.length === 0 ? (
          <EmptyState icon={Webhook} title="None received yet">
            In the GitHub App settings, “Advanced” shows deliveries and lets you redeliver one.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={ct.th}>Received</th>
                  <th className={ct.th}>Event</th>
                  <th className={ct.th}>Repository</th>
                  <th className={ct.th}>Result</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.deliveryId} className={`${table.row} align-top`}>
                    <td className={`${ct.td} whitespace-nowrap text-muted`}>{formatDateTime(d.receivedAt)}</td>
                    <td className={`${ct.td} font-mono text-xs`}>
                      {d.event}
                      {d.action && `.${d.action}`}
                    </td>
                    <td className={`${ct.td} text-muted`}>{d.repo ?? "—"}</td>
                    <td className={ct.td}>{d.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
