// Pure checks for uploaded files (Phase 9). Nothing here trusts the browser's file type: images
// and PDFs must start with their real signature, and only those are ever shown inline.

export const MAX_FILE_BYTES = 4 * 1024 * 1024;

const TYPES: Record<string, { mime: string; inline: boolean }> = {
  pdf: { mime: "application/pdf", inline: true },
  png: { mime: "image/png", inline: true },
  jpg: { mime: "image/jpeg", inline: true },
  jpeg: { mime: "image/jpeg", inline: true },
  gif: { mime: "image/gif", inline: true },
  webp: { mime: "image/webp", inline: true },
  txt: { mime: "text/plain", inline: false },
  csv: { mime: "text/csv", inline: false },
  md: { mime: "text/markdown", inline: false },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inline: false },
  zip: { mime: "application/zip", inline: false },
};

export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((b, i) => bytes[offset + i] === b);

/** The file type its bytes prove, for formats with a signature; null when unknown. */
export function sniff(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"; // GIF8
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "application/zip"; // also docx/xlsx/pptx
  return null;
}

/** A display-safe file name: no paths, no control characters, at most 120 characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "file";
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 120 - ext.length) + ext;
}

export type CheckedFile = { fileName: string; contentType: string; inline: boolean; sizeBytes: number };

/** Validates an upload; returns the safe name and the type to store, or an error message. */
export function checkFile(name: string, bytes: Uint8Array): CheckedFile | { error: string } {
  if (bytes.length === 0) return { error: "The file is empty." };
  if (bytes.length > MAX_FILE_BYTES) return { error: "Files can be at most 4 MB." };
  const fileName = cleanFileName(name);
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const type = TYPES[ext];
  if (!type) return { error: `That file type is not allowed. Use: ${ALLOWED_EXTENSIONS.join(", ")}.` };
  const actual = sniff(bytes);
  const officeOrZip = ["docx", "xlsx", "pptx", "zip"].includes(ext);
  if (type.inline && actual !== type.mime) return { error: `The file content does not match .${ext}.` };
  if (officeOrZip && actual !== "application/zip") return { error: `The file content does not match .${ext}.` };
  if (!type.inline && !officeOrZip && actual !== null) return { error: `The file content does not match .${ext}.` };
  return { fileName, contentType: type.mime, inline: type.inline, sizeBytes: bytes.length };
}

export function isInlineType(contentType: string): boolean {
  return ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
