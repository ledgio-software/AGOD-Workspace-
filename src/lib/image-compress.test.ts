import { describe, expect, it } from "vitest";
import { fitWithin, formatSize, renamed } from "./image-compress";

describe("making pictures smaller (Phase 26.1)", () => {
  it("fits the longest side within 1600 pixels without enlarging", () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600, scaled: true });
    expect(fitWithin(2400, 1080)).toEqual({ width: 1600, height: 720, scaled: true });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
    expect(fitWithin(1, 10000)).toEqual({ width: 1, height: 1600, scaled: true });
  });

  it("renames the file for its new type", () => {
    expect(renamed("Screen Shot 2026.png", "image/webp")).toBe("Screen Shot 2026.webp");
    expect(renamed("photo.jpeg", "image/jpeg")).toBe("photo.jpg");
    expect(renamed(".png", "image/webp")).toBe("screenshot.webp");
  });

  it("describes sizes", () => {
    expect(formatSize(3_200_000)).toBe("3.1 MB");
    expect(formatSize(245_000)).toBe("239 KB");
    expect(formatSize(10)).toBe("1 KB");
  });
});
