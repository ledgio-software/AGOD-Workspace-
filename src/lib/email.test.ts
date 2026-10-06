import { describe, expect, it } from "vitest";
import { smtpHint } from "./email";

describe("explaining a refused mail login", () => {
  const gmail = "Invalid login: 535-5.7.8 Username and Password not accepted. For more information, go to 535 5.7.8 https://support.google.com/mail/?p=BadCredentials";

  it("tells Gmail users to use an App Password", () => {
    const hint = smtpHint("smtp.gmail.com", gmail);
    expect(hint).toMatch(/App Password/);
    expect(hint).toMatch(/SMTP_PASS/);
    expect(hint).toMatch(/redeploy/);
  });

  it("gives a general hint for other providers, and none for other errors", () => {
    expect(smtpHint("smtp.zoho.com", "535 Authentication Failed")).toMatch(/SMTP_USER and SMTP_PASS/);
    expect(smtpHint("smtp.gmail.com", "connect ECONNREFUSED 127.0.0.1:1")).toBe("");
  });
});
