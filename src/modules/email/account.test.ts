import { describe, expect, it } from "vitest";
import { PRODUCT_NAME } from "@/lib/brand";
import { addedToCompanyMessage, existingSignUpMessage, inviteMessage, resetPasswordMessage, verifyEmailMessage } from "./account";

describe("account emails", () => {
  it("carry the link in text and HTML, and greet by first name", () => {
    const m = verifyEmailMessage({ name: "Ama Mensah", url: "https://app.example/api/auth/verify-email?token=t1" });
    expect(m.subject).toContain(PRODUCT_NAME);
    expect(m.text).toContain("Hi Ama,");
    expect(m.text).toContain("https://app.example/api/auth/verify-email?token=t1");
    expect(m.html).toContain('href="https://app.example/api/auth/verify-email?token=t1"');
    expect(resetPasswordMessage({ name: "Kofi", url: "https://x/r" }).text).toContain("only once");
  });

  it("escapes names and company names in HTML", () => {
    const m = inviteMessage({ name: "<b>Efua</b>", company: "Acme & <Co>", invitedBy: "Kwame", url: "https://x/i?a=1&b=2" });
    expect(m.subject).toBe("Kwame invited you to Acme & <Co>");
    expect(m.html).not.toContain("<b>Efua</b>");
    expect(m.html).toContain("Acme &amp; &lt;Co&gt;");
    expect(m.html).toContain('href="https://x/i?a=1&amp;b=2"');
    expect(addedToCompanyMessage({ name: "Ama", company: "Acme", invitedBy: "Kwame", url: "https://x/sign-in" }).text).toContain("company menu");
    expect(existingSignUpMessage({ name: "Ama", signInUrl: "https://x/sign-in", resetUrl: "https://x/forgot-password" }).text).toContain("already have one");
  });
});
