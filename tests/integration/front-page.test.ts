import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { users } from "@/lib/db/schema";
import { type Member, ensureProfile } from "@/modules/community";
import { MAX_FRONT_PHOTOS, addFrontPhoto, frontPage, openFrontPhoto, removeFrontPhoto, setWelcomeVideo } from "@/modules/community/front";
import { db } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 35: the community front page photos and welcome video.

beforeAll(() => vi.stubEnv("LOCAL_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "agod-front-"))));

async function member(name: string): Promise<Member> {
  const id = randomUUID();
  const m = { id, name, email: `${id}@agod.test` };
  await db.insert(users).values({ ...m, emailVerified: true });
  await ensureProfile(m);
  return m;
}

/** A small PNG: the signature, then different bytes each time so photos differ. */
const png = () => {
  const b = new Uint8Array(400);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set(new TextEncoder().encode(randomUUID()), 16);
  return b;
};

describe("front page", () => {
  it("only organizers change it; photos are checked, deduplicated and capped; video links must play", async () => {
    const org = await member("Organizer");
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", org.email);
    const someone = await member("Builder");
    await expect(addFrontPhoto(someone, { name: "a.png", bytes: png() }, { alt: "Members at a meet-up" })).rejects.toThrow(/organizers/);
    await expect(setWelcomeVideo(someone, { url: "https://youtu.be/dQw4w9WgXcQ", title: "" })).rejects.toThrow(/organizers/);

    await expect(addFrontPhoto(org, { name: "a.png", bytes: png() }, { alt: "x" })).rejects.toThrow(/what the photo shows/);
    await expect(addFrontPhoto(org, { name: "a.pdf", bytes: new TextEncoder().encode("%PDF-1.7 hello") }, { alt: "A document" })).rejects.toThrow();

    // Start from an empty front page (other test runs may have left photos).
    for (const p of (await frontPage()).photos) await removeFrontPhoto(org, p.id);
    const same = png();
    const first = await addFrontPhoto(org, { name: "a.png", bytes: same }, { alt: "Members at the Accra meet-up" });
    await expect(addFrontPhoto(org, { name: "b.png", bytes: same }, { alt: "Same photo again" })).rejects.toThrow(/already on the front page/);
    for (let i = 1; i < MAX_FRONT_PHOTOS; i++) await addFrontPhoto(org, { name: `p${i}.png`, bytes: png() }, { alt: `Photo number ${i}` });
    await expect(addFrontPhoto(org, { name: "z.png", bytes: png() }, { alt: "One too many" })).rejects.toThrow(/6 photos/);
    expect((await frontPage()).photos[0]).toEqual({ id: first, alt: "Members at the Accra meet-up" });
    expect((await openFrontPhoto(first))!.photo.contentType).toBe("image/png");
    await removeFrontPhoto(org, first);
    expect(await openFrontPhoto(first)).toBeNull();
    expect((await frontPage()).photos).toHaveLength(MAX_FRONT_PHOTOS - 1);

    await expect(setWelcomeVideo(org, { url: "https://example.com/video.mp4", title: "" })).rejects.toThrow(/YouTube, Vimeo, Loom or Google Drive/);
    await setWelcomeVideo(org, { url: "https://youtu.be/dQw4w9WgXcQ", title: "What we're about" });
    expect((await frontPage()).video).toMatchObject({ title: "What we're about", embed: { provider: "YouTube" } });
    await setWelcomeVideo(org, { url: "", title: "ignored" });
    expect((await frontPage()).video).toBeNull();
  });
});
