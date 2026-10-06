import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

// Phase 19: outgoing email over SMTP (Nodemailer) when SMTP_HOST is set; otherwise email is off.
// Works with any mail provider that offers SMTP (Gmail/Google Workspace, Zoho, Microsoft 365, a host's
// mail server, ...). Outside Vercel, EMAIL_OUTBOX_DIR writes each email to a JSON file instead
// (local testing only).

export type EmailAttachment = { filename: string; content: Uint8Array; contentType: string };
export type EmailMessage = { to: string; subject: string; text: string; html: string; attachments?: EmailAttachment[] };

export type EmailConfig =
  | { provider: "smtp"; host: string; port: number; secure: boolean; user?: string; pass?: string; from: string }
  | { provider: "outbox"; dir: string; from: string };

type Source = Record<string, string | undefined>;

export function emailConfig(source: Source = process.env): EmailConfig | null {
  const host = source.SMTP_HOST?.trim();
  const user = source.SMTP_USER?.trim() || undefined;
  const from = source.EMAIL_FROM?.trim() || user;
  if (host && from) {
    const port = Number(source.SMTP_PORT?.trim() || 587);
    const secure = source.SMTP_SECURE ? source.SMTP_SECURE.trim() === "true" : port === 465;
    return { provider: "smtp", host, port: Number.isFinite(port) ? port : 587, secure, user, pass: source.SMTP_PASS || undefined, from };
  }
  if (source.EMAIL_OUTBOX_DIR?.trim() && !source.VERCEL_ENV) {
    return { provider: "outbox", dir: source.EMAIL_OUTBOX_DIR.trim(), from: from || "AGOD <agod@localhost>" };
  }
  return null;
}

export async function sendEmail(config: EmailConfig, message: EmailMessage): Promise<{ id: string }> {
  if (config.provider === "outbox") {
    await mkdir(config.dir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { attachments = [], ...rest } = message;
    await writeFile(
      path.join(config.dir, `${id}.json`),
      JSON.stringify({ from: config.from, ...rest, attachments: attachments.map((a) => ({ filename: a.filename, bytes: a.content.length })) }, null, 2),
    );
    for (const a of attachments) await writeFile(path.join(config.dir, `${id}-${a.filename}`), a.content);
    return { id };
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    const info = await transport.sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
      // Our messages never attach files or fetch URLs.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return { id: info.messageId };
  } catch (error) {
    throw new Error(`The mail server refused the message: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    transport.close();
  }
}

/** Where email goes, for the Integrations page (never includes the password). */
export function describeEmail(config: EmailConfig): string {
  return config.provider === "smtp" ? `${config.host}:${config.port}${config.secure ? " (TLS)" : ""}` : config.dir;
}
