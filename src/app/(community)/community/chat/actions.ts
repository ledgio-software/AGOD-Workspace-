"use server";

import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getSignedIn } from "@/lib/session";
import { deleteMessage, mentionSuggestions, postMessage, reactToMessage, reportMessage, setHidden, setSolved } from "@/modules/community/chat";

// Phase 36: community chat. The page refreshes itself after each action (no page reload).

async function member() {
  const me = await getSignedIn();
  if (!me) redirect("/sign-in");
  return me;
}

export async function postChatAction(slug: string, parentId: string | null, body: string): Promise<ActionResult<string>> {
  const me = await member();
  return runAction(() => postMessage(me, slug, { body }, parentId));
}

export async function reactChatAction(messageId: string, emoji: string): Promise<ActionResult<boolean>> {
  const me = await member();
  return runAction(() => reactToMessage(me, messageId, emoji));
}

export async function solveChatAction(messageId: string, solved: boolean): Promise<ActionResult> {
  const me = await member();
  return runAction(async () => {
    await setSolved(me, messageId, solved);
    return undefined;
  });
}

export async function deleteChatAction(messageId: string): Promise<ActionResult> {
  const me = await member();
  return runAction(async () => {
    await deleteMessage(me, messageId);
    return undefined;
  });
}

export async function reportChatAction(messageId: string, reason: string): Promise<ActionResult> {
  const me = await member();
  return runAction(async () => {
    await reportMessage(me, messageId, { reason });
    return undefined;
  }, "Thank you. The organizers will look at it.");
}

export async function hideChatAction(messageId: string, hidden: boolean): Promise<ActionResult> {
  const me = await member();
  return runAction(async () => {
    await setHidden(me, messageId, hidden);
    return undefined;
  });
}

export async function suggestPeopleAction(query: string): Promise<{ handle: string; name: string }[]> {
  const me = await member();
  return mentionSuggestions(me, query);
}
