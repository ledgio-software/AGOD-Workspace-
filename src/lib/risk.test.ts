import { describe, expect, it } from "vitest";
import { FLAG_SCORE, HOLD_SCORE, linkSignals, linksIn, scanText } from "./risk";

const keys = (text: string) => scanText(text).signals.map((s) => s.key);

describe("scanText", () => {
  it("finds the usual job scams", () => {
    expect(keys("Pay a registration fee of GHS 200 to start")).toContain("fee");
    expect(keys("There is a refundable deposit before you start")).toContain("fee");
    expect(keys("Send your MoMo PIN so we can pay you")).toContain("credentials");
    expect(keys("Please send me your Ghana Card photo and OTP")).toContain("credentials");
    expect(keys("Double your money in 7 days, guaranteed profit")).toContain("investment");
    expect(keys("Earn GHS 500 daily, work from home and earn")).toContain("investment");
    expect(keys("WhatsApp me on 024 123 4567, limited slots")).toEqual(expect.arrayContaining(["offplatform", "urgency"]));
  });

  it("scores scams high enough to hold, and leaves normal posts alone", () => {
    expect(scanText("Pay a training fee, then send your MoMo PIN").score).toBeGreaterThanOrEqual(HOLD_SCORE);
    const normal = scanText("We need a React developer for a 2-week gig building a MoMo checkout page. Pay GHS 3,000 for the work. Repo: https://github.com/acme/shop");
    expect(normal.score).toBe(0);
    expect(scanText("Our team uses Paystack and Hubtel for payments; see https://paystack.com/docs").score).toBe(0);
    expect(scanText("I built an app to help market women track MoMo sales").score).toBeLessThan(FLAG_SCORE);
  });

  it("counts each kind of signal once and caps at 100", () => {
    const r = scanText("registration fee, processing fee, pay a deposit, send your PIN, double your money, guaranteed profit, bit.ly/x https://192.168.0.1/a https://paypal-login.top");
    expect(r.signals.filter((s) => s.key === "fee")).toHaveLength(1);
    expect(r.score).toBe(100);
  });
});

describe("links", () => {
  it("pulls links out of text", () => {
    expect(linksIn("see https://a.com/x, and www.b.com. Also https://a.com/x")).toEqual(["https://a.com/x", "www.b.com"]);
  });

  it("flags links that hide or fake where they go", () => {
    expect(linkSignals("https://bit.ly/3abc").map((s) => s.key)).toEqual(["shortener"]);
    expect(linkSignals("http://45.12.8.9/login").map((s) => s.key)).toEqual(["ip-link", "insecure-link"]);
    expect(linkSignals("https://rnicrosoft.com/login")[0]).toMatchObject({ key: "lookalike", weight: 45 });
    expect(linkSignals("https://mtn-momo-bonus.xyz")[0]).toMatchObject({ key: "lookalike", label: "Address pretends to be mtn" });
    expect(linkSignals("https://xn--pypal-4ve.com").map((s) => s.key)).toContain("punycode");
  });

  it("trusts the brands' own sites", () => {
    for (const ok of ["https://github.com/acme", "https://docs.github.com/en", "https://www.mtn.com.gh/momo", "https://mtn.com.gh", "https://www.google.com", "https://paystack.com/pricing", "https://example.com"]) {
      expect(linkSignals(ok)).toEqual([]);
    }
  });
});
