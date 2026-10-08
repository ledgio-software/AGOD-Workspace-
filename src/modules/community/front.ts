import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { communitySettings, frontPhotos } from "@/lib/db/schema";
import { checkFile } from "@/lib/files";
import { storage } from "@/lib/storage";
import { ServiceError } from "@/modules/errors";
import { type Member, canModerate } from "./index";
import { type VideoEmbed, videoEmbed } from "./video";

// Phase 35: the community front page. Organizers choose up to six background photos (shown as a
// slideshow behind the welcome text) and a welcome video shown beside it. Everything is public.

export const MAX_FRONT_PHOTOS = 6;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type FrontPage = {
  photos: { id: string; alt: string }[];
  video: { url: string; title: string | null; embed: VideoEmbed } | null;
};

export async function frontPage(): Promise<FrontPage> {
  const [photos, [settings]] = await Promise.all([
    db
      .select({ id: frontPhotos.id, alt: frontPhotos.alt })
      .from(frontPhotos)
      .where(isNull(frontPhotos.removedAt))
      .orderBy(asc(frontPhotos.position), asc(frontPhotos.createdAt)),
    db.select().from(communitySettings).where(eq(communitySettings.id, 1)),
  ]);
  const embed = videoEmbed(settings?.welcomeVideoUrl);
  return { photos, video: embed && settings?.welcomeVideoUrl ? { url: settings.welcomeVideoUrl, title: settings.welcomeVideoTitle, embed } : null };
}

export const photosAvailable = () => storage() !== null;

async function requireOrganizer(member: Member) {
  if (!(await canModerate(member))) throw new ServiceError("Only community organizers can change the front page.");
}

export const photoInput = z.object({ alt: z.string().trim().min(3, "Say what the photo shows (at least 3 characters)").max(200) });

/** Organizers: adds a background photo (PNG, JPG, WebP or GIF, up to 4 MB). */
export async function addFrontPhoto(member: Member, file: { name: string; bytes: Uint8Array }, raw: z.input<typeof photoInput>) {
  const { alt } = photoInput.parse(raw);
  await requireOrganizer(member);
  const store = storage();
  if (!store) throw new ServiceError("Photo uploads aren't switched on yet: connect file storage first (see docs/SETUP.md).");
  const checked = checkFile(file.name, file.bytes);
  if ("error" in checked) throw new ServiceError(checked.error);
  if (!IMAGE_TYPES.includes(checked.contentType)) throw new ServiceError("Photos must be PNG, JPG, WebP or GIF images.");
  const current = await db.select({ position: frontPhotos.position, sha256: frontPhotos.sha256 }).from(frontPhotos).where(isNull(frontPhotos.removedAt));
  if (current.length >= MAX_FRONT_PHOTOS) throw new ServiceError(`The front page can have ${MAX_FRONT_PHOTOS} photos. Remove one first.`);
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  if (current.some((r) => r.sha256 === sha256)) throw new ServiceError("This photo is already on the front page.");
  const ext = checked.contentType.split("/")[1].replace("jpeg", "jpg");
  const key = await store.put(`community/front/${sha256.slice(0, 2)}/${sha256}.${ext}`, file.bytes, checked.contentType);
  const position = current.reduce((max, r) => Math.max(max, r.position), -1) + 1;
  const [photo] = await db
    .insert(frontPhotos)
    .values({ storageKey: key, contentType: checked.contentType, sizeBytes: checked.sizeBytes, sha256, alt, position, addedBy: member.id })
    .returning({ id: frontPhotos.id });
  return photo.id;
}

export async function removeFrontPhoto(member: Member, photoId: string) {
  await requireOrganizer(member);
  if (!z.uuid().safeParse(photoId).success) throw new ServiceError("Photo not found.");
  const [updated] = await db
    .update(frontPhotos)
    .set({ removedAt: new Date() })
    .where(and(eq(frontPhotos.id, photoId), isNull(frontPhotos.removedAt)))
    .returning({ id: frontPhotos.id });
  if (!updated) throw new ServiceError("Photo not found.");
}

/** For the public photo route. */
export async function openFrontPhoto(photoId: string) {
  if (!z.uuid().safeParse(photoId).success) return null;
  const [photo] = await db.select().from(frontPhotos).where(and(eq(frontPhotos.id, photoId), isNull(frontPhotos.removedAt)));
  const store = storage();
  if (!photo || !store) return null;
  const file = await store.get(photo.storageKey);
  return file ? { photo, body: file.body } : null;
}

export const videoInput = z.object({
  url: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || null)
    .refine((v) => v === null || videoEmbed(v) !== null, "Paste a YouTube, Vimeo, Loom or Google Drive video link"),
  title: z
    .string()
    .trim()
    .max(120)
    .transform((v) => v || null),
});

/** Organizers: sets the welcome video (or removes it with an empty link). */
export async function setWelcomeVideo(member: Member, raw: z.input<typeof videoInput>) {
  const input = videoInput.parse(raw);
  await requireOrganizer(member);
  if (input.title && input.title.length < 2) throw new ServiceError("The title needs at least 2 characters.");
  const values = { welcomeVideoUrl: input.url, welcomeVideoTitle: input.url ? input.title : null, updatedBy: member.id };
  await db
    .insert(communitySettings)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: communitySettings.id, set: values });
}
