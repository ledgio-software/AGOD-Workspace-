import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { formatMoney } from "@/lib/money";

// Phase 20: the invoice as a PDF (A4), drawn with pdf-lib and the built-in Helvetica fonts, so no
// font files or browser are needed on the server. Text outside Helvetica's character set (the
// WinAnsi range) is replaced with "?" instead of failing.

export type InvoicePdfInput = {
  number: string | null;
  status: "DRAFT" | "ISSUED" | "VOID";
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  billToName: string | null;
  notes: string | null;
  lines: { description: string; quantity: number; unitPriceMinor: number; amountMinor: number }[];
  seller: {
    businessName: string;
    address: string | null;
    email: string | null;
    phone: string | null;
    taxId: string | null;
    paymentInstructions: string | null;
    footer: string | null;
  };
  /** Shown instead of the bill-to name on drafts. */
  customerName: string;
  /** Shown as a stamp. */
  paid: boolean;
};

const A4: [number, number] = [595.28, 841.89];
const M = 48;
const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.42, 0.47);
const LINE = rgb(0.85, 0.85, 0.88);
const BRAND = rgb(0.31, 0.27, 0.9);

export function safeText(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return Array.from(text.replace(/\r/g, "").replace(/\t/g, " "))
    .map((ch) => (ch === "\n" || supported.has(ch.codePointAt(0)!) ? ch : "?"))
    .join("");
}

export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of safeText(font, text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // A single very long word is cut to fit.
      candidate = word;
      while (font.widthOfTextAtSize(candidate, size) > width && candidate.length > 1) {
        let cut = candidate.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(candidate.slice(0, cut), size) > width) cut -= 1;
        out.push(candidate.slice(0, cut));
        candidate = candidate.slice(cut);
      }
      line = candidate;
    }
    out.push(line);
  }
  return out;
}

export async function invoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.number ? `Invoice ${input.number}` : "Draft invoice");
  doc.setProducer("AGOD");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const right = A4[0] - M;
  const contentWidth = right - M;

  const text = (t: string, x: number, size = 10, font = regular, color = INK) => {
    page.drawText(safeText(font, t), { x, y, size, font, color });
  };
  const textRight = (t: string, xRight: number, size = 10, font = regular, color = INK) => {
    const s = safeText(font, t);
    page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, size, font, color });
  };
  const rule = (color = LINE) => page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 0.6, color });
  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - M;
  };

  // Header: seller on the left, title and number on the right.
  text(input.seller.businessName, M, 16, bold, BRAND);
  textRight("INVOICE", right, 20, bold);
  y -= 18;
  const sellerLines = [input.seller.address, input.seller.email, input.seller.phone, input.seller.taxId ? `Tax ID: ${input.seller.taxId}` : null]
    .filter((v): v is string => !!v)
    .flatMap((v) => wrap(regular, v, 9, 260));
  const top = y;
  for (const l of sellerLines) {
    text(l, M, 9, regular, MUTED);
    y -= 12;
  }
  const afterSeller = y;
  y = top;
  textRight(input.number ?? "DRAFT", right, 12, bold);
  y -= 14;
  if (input.issueDate) {
    textRight(`Issued ${input.issueDate}`, right, 9, regular, MUTED);
    y -= 12;
  }
  if (input.dueDate) {
    textRight(`Due ${input.dueDate}`, right, 9, regular, MUTED);
    y -= 12;
  }
  y = Math.min(y, afterSeller) - 16;
  rule();
  y -= 22;

  // Bill to.
  text("BILL TO", M, 8, bold, MUTED);
  y -= 13;
  for (const l of wrap(bold, input.billToName ?? input.customerName, 11, 300)) {
    text(l, M, 11, bold);
    y -= 14;
  }
  y -= 14;

  // Lines table.
  // Right edges of the number columns; the description wraps to fit before the quantity.
  const qtyRight = M + contentWidth * 0.6;
  const unitRight = M + contentWidth * 0.8;
  const descWidth = qtyRight - M - 48;
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: contentWidth, height: 22, color: rgb(0.96, 0.96, 0.97) });
    text("DESCRIPTION", M + 8, 8, bold, MUTED);
    textRight("QTY", qtyRight, 8, bold, MUTED);
    textRight("UNIT PRICE", unitRight, 8, bold, MUTED);
    textRight("AMOUNT", right - 8, 8, bold, MUTED);
    y -= 24;
  };
  header();
  for (const line of input.lines) {
    const desc = wrap(regular, line.description, 10, descWidth);
    if (y - desc.length * 13 < M + 150) {
      newPage();
      header();
    }
    const startY = y;
    for (const d of desc) {
      text(d, M + 8, 10);
      y -= 13;
    }
    const endY = y;
    y = startY;
    textRight(String(line.quantity), qtyRight);
    textRight(formatMoney(line.unitPriceMinor, input.currency), unitRight);
    textRight(formatMoney(line.amountMinor, input.currency), right - 8);
    y = endY - 4;
    rule();
    y -= 12;
  }

  // Totals.
  if (y < M + 130) newPage();
  y -= 4;
  const labelX = M + contentWidth * 0.58;
  const total = (label: string, value: string, strong = false) => {
    text(label, labelX, strong ? 11 : 10, strong ? bold : regular, strong ? INK : MUTED);
    textRight(value, right - 8, strong ? 11 : 10, strong ? bold : regular);
    y -= strong ? 18 : 15;
  };
  total("Total", formatMoney(input.totalMinor, input.currency), input.paidMinor === 0);
  if (input.status === "ISSUED" && input.paidMinor > 0) {
    total("Paid", `- ${formatMoney(input.paidMinor, input.currency)}`);
    total("Balance due", formatMoney(input.totalMinor - input.paidMinor, input.currency), true);
  }

  // Notes, payment instructions, footer.
  const block = (title: string, body: string) => {
    const lines = wrap(regular, body, 9, contentWidth);
    if (y - lines.length * 12 - 24 < M) newPage();
    y -= 10;
    text(title, M, 8, bold, MUTED);
    y -= 13;
    for (const l of lines) {
      text(l, M, 9);
      y -= 12;
    }
  };
  if (input.notes) block("NOTES", input.notes);
  if (input.seller.paymentInstructions && !input.paid && input.status !== "VOID") block("HOW TO PAY", input.seller.paymentInstructions);
  if (input.seller.footer) {
    y = M - 8;
    const lines = wrap(regular, input.seller.footer, 8, contentWidth);
    for (const l of lines) {
      text(l, M, 8, regular, MUTED);
      y -= 10;
    }
  }

  // Stamp over the first page.
  const stamp = input.status === "VOID" ? "VOID" : input.status === "DRAFT" ? "DRAFT" : input.paid ? "PAID" : null;
  if (stamp) {
    const first = doc.getPage(0);
    first.drawText(stamp, {
      x: A4[0] / 2 - 120,
      y: A4[1] / 2 - 40,
      size: 100,
      font: bold,
      color: stamp === "PAID" ? rgb(0.1, 0.55, 0.3) : rgb(0.6, 0.6, 0.64),
      opacity: 0.12,
      rotate: degrees(30),
    });
  }
  return doc.save();
}
