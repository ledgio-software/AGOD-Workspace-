"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { requireUser } from "@/lib/session";
import { sendMessage, startConversation } from "@/modules/messages";

// Phase 30: start a conversation, send a message.

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
