import { describe, expect, it } from "vitest";
import { checkFile, cleanFileName, formatBytes, sniff } from "./files";

const pdf = new TextEncoder().encode("%PDF-1.7\n...");
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]);
const text = new TextEncoder().encode("hello,world\n");

describe("file checks", () => {
  it("accepts files whose content matches their extension", () => {
    expect(checkFile("receipt.PDF", pdf)).toMatchObject({ fileName: "receipt.PDF", contentType: "application/pdf", inline: true });
    expect(checkFile("screen.png", png)).toMatchObject({ contentType: "image/png", inline: true });
    expect(checkFile("report.xlsx", zip)).toMatchObject({ inline: false });
    expect(checkFile("data.csv", text)).toMatchObject({ contentType: "text/csv", inline: false });
  });

  it("rejects disguised, unknown, empty and oversized files", () => {
    expect(checkFile("receipt.pdf", text)).toEqual({ error: "The file content does not match .pdf." });
    expect(checkFile("notes.txt", pdf)).toEqual({ error: "The file content does not match .txt." });
    expect(checkFile("report.docx", text)).toEqual({ error: "The file content does not match .docx." });
    expect(checkFile("page.html", text)).toMatchObject({ error: expect.stringContaining("not allowed") });
    expect(checkFile("logo.svg", text)).toMatchObject({ error: expect.stringContaining("not allowed") });
    expect(checkFile("noext", text)).toMatchObject({ error: expect.stringContaining("not allowed") });
    expect(checkFile("a.txt", new Uint8Array())).toEqual({ error: "The file is empty." });
    expect(checkFile("a.txt", new Uint8Array(4 * 1024 * 1024 + 1))).toEqual({ error: "Files can be at most 4 MB." });
  });

  it("cleans names and sniffs signatures", () => {
    expect(cleanFileName("C:\\fakepath\\..\\My <Receipt>.pdf")).toBe("My Receipt.pdf");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName(`${"a".repeat(200)}.pdf`)).toHaveLength(120);
    expect(cleanFileName("\u0000")).toBe("file");
    expect(sniff(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(formatBytes(1536)).toBe("2 KB");
  });
});
