import { notificationPath } from "@/modules/notifications/links";

// Phase 19: the daily email. Pure, so its wording and escaping are unit-tested.

export type DigestItem = {
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function buildDigest(input: { name: string; items: DigestItem[]; baseUrl: string }) {
  const base = input.baseUrl.replace(/\/$/, "");
  const first = input.name.split(/\s+/)[0] || input.name;
  const n = input.items.length;
  const subject = n === 1 ? `AGOD: ${input.items[0].title}` : `AGOD: ${n} updates for you`;
  const link = (i: DigestItem) => `${base}${notificationPath(i.entityType, i.entityId) ?? "/my-work"}`;

  const text = [
    `Hi ${first},`,
    "",
    n === 1 ? "Here is an update from AGOD:" : `Here are ${n} updates from AGOD:`,
    "",
    ...input.items.flatMap((i) => [`• ${i.title}`, `  ${i.message}`, `  ${link(i)}`, ""]),
    `See everything in My work: ${base}/my-work`,
    "",
    `You get this email once a day when there is something new. Turn it off on your Account page: ${base}/account`,
  ].join("\n");

  const rows = input.items
    .map(
      (i) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e4e4e7">
  <a href="${escapeHtml(link(i))}" style="color:#4f46e5;font-weight:600;text-decoration:none">${escapeHtml(i.title)}</a>
  <div style="color:#52525b;margin-top:4px">${escapeHtml(i.message)}</div>
</td></tr>`,
    )
    .join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">
<tr><td style="padding:24px">
<div style="font-weight:700;font-size:16px;margin-bottom:16px">AGOD</div>
<p style="margin:0 0 8px">Hi ${escapeHtml(first)},</p>
<p style="margin:0 0 8px">${n === 1 ? "Here is an update from AGOD:" : `Here are ${n} updates from AGOD:`}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<p style="margin:20px 0 0"><a href="${escapeHtml(base)}/my-work" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open My work</a></p>
<p style="margin:20px 0 0;color:#71717a;font-size:12px">You get this email once a day when there is something new. <a href="${escapeHtml(base)}/account" style="color:#71717a">Turn it off on your Account page.</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
