import { AccessDenied } from "@/components/access-denied";
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
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">GitHub integration</h1>
        <p className="text-sm text-zinc-500">
          Links tasks to issues and pull requests, moves tasks to In review and Ready for QA, and records deployments and releases.
          Setup steps: <code>docs/GITHUB_APP.md</code>.
        </p>
      </div>

      <section className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <h2 className="font-semibold">Status</h2>
        {!config ? (
          <p className="text-amber-700">
            Not set up. Add GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET to this environment in Vercel, then redeploy.
          </p>
        ) : check?.ok ? (
          <p className="text-green-700">
            Connected as the GitHub App “{check.name}”{check.owner && ` owned by ${check.owner}`}.
          </p>
        ) : (
          <p className="text-red-700">Configured, but GitHub refused the app: {check?.error}</p>
        )}
        <p>
          Webhook URL for this environment: <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">{webhookUrl}</code>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Recent webhook deliveries</h2>
        {deliveries.length === 0 ? (
          <p className="text-sm text-zinc-500">None received yet. In the GitHub App settings, “Advanced” shows deliveries and lets you redeliver one.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Received</th>
                <th className="py-1 pr-3 font-medium">Event</th>
                <th className="py-1 pr-3 font-medium">Repository</th>
                <th className="py-1 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.deliveryId} className="border-t border-zinc-100 align-top dark:border-zinc-900">
                  <td className="py-1 pr-3 whitespace-nowrap">{formatDateTime(d.receivedAt)}</td>
                  <td className="py-1 pr-3">
                    {d.event}
                    {d.action && `.${d.action}`}
                  </td>
                  <td className="py-1 pr-3">{d.repo ?? "—"}</td>
                  <td className="py-1">{d.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
