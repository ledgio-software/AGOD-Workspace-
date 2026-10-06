import { describe, expect, it } from "vitest";
import { emailConfig } from "@/lib/email";
import { buildDigest } from "./digest";

describe("daily email", () => {
  const item = { title: "Renewal due: Hosting for Northwind", message: "Renews 2026-10-20.", entityType: "subscription", entityId: "abc" };

  it("links each item and names the single update in the subject", () => {
    const d = buildDigest({ name: "Ama Mensah", items: [item], baseUrl: "https://agod.example/" });
    expect(d.subject).toBe("AGOD: Renewal due: Hosting for Northwind");
    expect(d.text).toContain("Hi Ama,");
    expect(d.text).toContain("https://agod.example/subscriptions/abc");
    expect(d.html).toContain('href="https://agod.example/subscriptions/abc"');
  });

  it("counts several updates and escapes HTML in user text", () => {
    const d = buildDigest({
      name: "Kofi",
      items: [item, { title: "<script>x</script>", message: "Tom & Jerry", entityType: "comment", entityId: null }],
      baseUrl: "https://agod.example",
    });
    expect(d.subject).toBe("AGOD: 2 updates for you");
    expect(d.html).not.toContain("<script>");
    expect(d.html).toContain("&lt;script&gt;");
    expect(d.html).toContain("Tom &amp; Jerry");
    expect(d.text).toContain("https://agod.example/my-work");
  });
});

describe("email settings", () => {
  it("is off unless SMTP is configured, and the file outbox never runs on Vercel", () => {
    expect(emailConfig({})).toBeNull();
    expect(emailConfig({ SMTP_HOST: "smtp.example.com" })).toBeNull(); // no sender
    expect(emailConfig({ SMTP_HOST: "smtp.example.com", SMTP_USER: "me@example.com", SMTP_PASS: "x" })).toMatchObject({
      provider: "smtp",
      port: 587,
      secure: false,
      from: "me@example.com",
    });
    expect(emailConfig({ SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", EMAIL_FROM: "AGOD <hi@agod.example>" })).toMatchObject({ port: 465, secure: true });
    expect(emailConfig({ EMAIL_OUTBOX_DIR: "/tmp/out" })?.provider).toBe("outbox");
    expect(emailConfig({ EMAIL_OUTBOX_DIR: "/tmp/out", VERCEL_ENV: "preview" })).toBeNull();
  });
});
