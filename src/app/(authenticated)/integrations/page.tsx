import { CircleCheck, CircleX, Plug, TriangleAlert, Webhook } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Callout, Card, EmptyState, PageHeader, compactTable as ct, table } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { resolveBaseUrl } from "@/lib/env";
import { checkGithubApp, githubConfig } from "@/lib/github/app";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { recentDeliveries } from "@/modules/github";

export default async function IntegrationsPage() {
  const actor = await requireUser();
  if (!can(actor, "audit.viewAll")) return <AccessDenied what="integration settings" />;
  const config = githubConfig();
  const [check, deliveries] = await Promise.all([config ? checkGithubApp() : null, recentDeliveries(actor)]);
  const webhookUrl = `${resolveBaseUrl(process.env) ?? ""}/api/github/webhook`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Team & admin"
        title="GitHub integration"
        description={
          <>
            Links tasks to issues and pull requests, moves tasks to In review and Ready for QA, and records deployments and releases. Setup steps:{" "}
            <code className="rounded bg-surface-muted px-1 text-xs">docs/GITHUB_APP.md</code>.
          </>
        }
      />

      <Card title="Status" aside={<Plug className="size-4 text-muted" aria-hidden />}>
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
