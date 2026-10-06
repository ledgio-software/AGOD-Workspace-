import { timingSafeEqual } from "node:crypto";
import { sendSessionReminders } from "@/modules/community/sessions";
import { runDailyReminders } from "@/modules/jobs/daily";

// Phase 19: called once a day by Vercel Cron (vercel.json). Vercel sends
// "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set on the project; without it the
// endpoint refuses to run, so it can't be triggered by anyone else.

export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const companies = await runDailyReminders();
    // Phase 27: reminders for community sessions in the next 24 hours (platform-wide).
    const sessions = await sendSessionReminders().catch((error) => {
      console.error("Session reminders failed", error instanceof Error ? error.message : error);
      return { sent: 0, failed: -1 };
    });
    return Response.json({ ...companies, sessionReminders: sessions });
  } catch (error) {
    console.error("Daily reminders job failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Job failed" }, { status: 500 });
  }
}
