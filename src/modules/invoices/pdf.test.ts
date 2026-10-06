import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { type InvoicePdfInput, invoicePdf, safeText, wrap } from "./pdf";

const base: InvoicePdfInput = {
  number: "INV-2026-0007",
  status: "ISSUED",
  issueDate: "2026-10-06",
  dueDate: "2026-10-20",
  currency: "GHS",
  totalMinor: 123_456,
  paidMinor: 0,
  billToName: "Northwind Ltd — attn. Abena Owusu",
  customerName: "Northwind Ltd",
  notes: "Thank you for your business.",
  paid: false,
  lines: [{ description: "Managed hosting — 5 Oct 2026 – 4 Nov 2026", quantity: 2, unitPriceMinor: 45_000, amountMinor: 90_000 }],
  seller: { businessName: "AGOD", address: "Accra, Ghana", email: "billing@agod.example", phone: null, taxId: "C0001234567", paymentInstructions: "MoMo 024 000 0000\nBank: Example Bank 0123", footer: "AGOD, Accra" },
};

describe("invoice PDF", () => {
  it("produces a readable A4 PDF with the number as its title", async () => {
    const bytes = await invoicePdf(base);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Invoice INV-2026-0007");
  });

  it("spills long invoices onto more pages", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({ description: `Line ${i + 1}: ${"detailed work ".repeat(8)}`, quantity: 1, unitPriceMinor: 1_000, amountMinor: 1_000 }));
    const doc = await PDFDocument.load(await invoicePdf({ ...base, lines, totalMinor: 60_000 }));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("does not fail on characters Helvetica cannot draw, or on drafts, voids and paid invoices", async () => {
    const odd = { ...base, billToName: "Kofi Mensah-Ɔdɔ → 東京 ✓", notes: "Naïve café – “quotes”" };
    for (const variant of [odd, { ...base, status: "DRAFT" as const, number: null }, { ...base, status: "VOID" as const }, { ...base, paid: true, paidMinor: 123_456 }]) {
      const bytes = await invoicePdf(variant);
      expect(bytes.length).toBeGreaterThan(1000);
    }
  });

  it("replaces unsupported characters and wraps long text and long words", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(safeText(font, "Ɔdɔ → ok")).toBe("?d? ? ok");
    const lines = wrap(font, "word ".repeat(40), 10, 120);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((l) => font.widthOfTextAtSize(l, 10) <= 120)).toBe(true);
    const cut = wrap(font, "x".repeat(200), 10, 100);
    expect(cut.length).toBeGreaterThan(1);
    expect(cut.every((l) => font.widthOfTextAtSize(l, 10) <= 100)).toBe(true);
  });
});
