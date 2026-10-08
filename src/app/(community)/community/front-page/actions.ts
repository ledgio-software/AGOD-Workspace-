"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getSignedIn } from "@/lib/session";
import { addFrontPhoto, removeFrontPhoto, setWelcomeVideo } from "@/modules/community/front";

// Phase 35: organizers change the front page photos and welcome video.

type Result = ActionResult<undefined>;

async function member() {
  const me = await getSignedIn();
  if (!me) redirect("/sign-in");
  return me;
}

function refresh() {
  revalidatePath("/");
  revalidatePath("/community");
  revalidatePath("/community/front-page");
}

export async function addPhotoAction(_prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo." };
  const result = await runAction(async () => {
    await addFrontPhoto(me, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, { alt: String(form.get("alt") ?? "") });
    return undefined;
  }, "Photo added.");
  if (result.ok) refresh();
  return result;
}

export async function removePhotoAction(id: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await removeFrontPhoto(me, id);
    return undefined;
  }, "Photo removed.");
  if (result.ok) refresh();
  return result;
}

export async function videoAction(_prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const url = String(form.get("url") ?? "");
  const result = await runAction(async () => {
    await setWelcomeVideo(me, { url, title: String(form.get("title") ?? "") });
    return undefined;
  }, url.trim() ? "Video saved." : "Video removed.");
  if (result.ok) refresh();
  return result;
}
