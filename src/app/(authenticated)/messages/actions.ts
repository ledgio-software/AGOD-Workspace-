"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { requireUser } from "@/lib/session";
import { sendMessage, sendSticker, sendVoiceNote, startConversation, toggleReaction } from "@/modules/messages";

// Phase 30: start a conversation, send a message. Phase 34: stickers, voice notes, reactions.

export async function startConversationAction(_prev: ActionResult<string> | null, form: FormData): Promise<ActionResult<string>> {
  const actor = await requireUser();
  const result = await runAction(() =>
    startConversation(actor, {
      memberIds: form.getAll("memberIds").map(String),
      title: String(form.get("title") ?? ""),
      body: String(form.get("body") ?? ""),
    }),
  );
  if (!result.ok) return result;
  revalidatePath("/messages");
  redirect(`/messages?c=${result.data}`);
}

export async function sendMessageAction(conversationId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await sendMessage(actor, conversationId, { body: String(form.get("body") ?? "") });
    return undefined;
  });
  if (result.ok) revalidatePath("/messages");
  return result;
}

export async function sendStickerAction(conversationId: string, sticker: string): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await sendSticker(actor, conversationId, sticker);
    return undefined;
  });
  if (result.ok) revalidatePath("/messages");
  return result;
}

export async function sendVoiceAction(conversationId: string, form: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const file = form.get("voice");
  const result = await runAction(async () => {
    if (!(file instanceof Blob)) throw new Error("No recording");
    await sendVoiceNote(actor, conversationId, { bytes: new Uint8Array(await file.arrayBuffer()), seconds: Number(form.get("seconds")) });
    return undefined;
  });
  if (result.ok) revalidatePath("/messages");
  return result;
}

export async function reactAction(messageId: string, emoji: string): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await toggleReaction(actor, messageId, emoji);
    return undefined;
  });
  if (result.ok) revalidatePath("/messages");
  return result;
}
