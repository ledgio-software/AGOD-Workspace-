// Phase 26.1: pictures are made smaller in the browser before they are uploaded: at most 1600 pixels
// on the longest side, re-encoded as WebP (JPEG where the browser can't write WebP). A 3 MB phone
// screenshot usually becomes 150 to 300 KB: less storage for the platform, less mobile data for
// members, faster pages. Re-encoding also drops hidden details such as the GPS location of photos.
// GIFs are kept as they are (they may be animated). If anything fails, the original is used and the
// server checks it as before.

export const MAX_SIDE = 1600;
const QUALITY = 0.82;

/** The new size for an image of this size (never enlarged). */
export function fitWithin(width: number, height: number, maxSide = MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scaled: scale < 1 };
}

/** "screen.png" + "image/webp" → "screen.webp". */
export function renamed(name: string, type: string) {
  const ext = type === "image/webp" ? "webp" : "jpg";
  const base = name.replace(/\.[^./\\]+$/, "") || "screenshot";
  return `${base}.${ext}`;
}

const toBlob = (canvas: HTMLCanvasElement, type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));

export async function compressImage(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    let blob = await toBlob(canvas, "image/webp");
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg");
    if (!blob || (blob.size >= file.size && !size.scaled)) return file;
    return new File([blob], renamed(file.name, blob.type), { type: blob.type, lastModified: Date.now() });
  } catch {
    return file;
  }
}

export function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
