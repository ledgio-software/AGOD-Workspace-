import { githubConfig } from "@/lib/github/app";
import { verifyWebhookSignature } from "@/lib/github/signature";
import { handleGithubDelivery } from "@/modules/github/webhook";

// GitHub App webhook (roadmap 2.5). Public by necessity (excluded from the sign-in redirect in
// src/proxy.ts), so nothing is trusted until GitHub's HMAC signature over the raw body checks out.

const MAX_BODY_BYTES = 1_000_000;

export async function POST(request: Request) {
  const config = githubConfig();
  if (!config) return Response.json({ error: "GitHub integration is not configured" }, { status: 503 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "Payload too large" }, { status: 413 });
  if (!verifyWebhookSignature(config.webhookSecret, raw, request.headers.get("x-hub-signature-256"))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");
  if (!event || !deliveryId) return Response.json({ error: "Missing GitHub headers" }, { status: 400 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await handleGithubDelivery({ deliveryId, event, payload: payload as Parameters<typeof handleGithubDelivery>[0]["payload"] });
    return Response.json(result);
  } catch (error) {
    // Rolled back: GitHub shows the failure and the delivery can be redelivered.
    console.error("GitHub webhook failed", deliveryId, error instanceof Error ? error.message : error);
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
