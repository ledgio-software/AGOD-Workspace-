import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { withActor } from "@/lib/db/actor";
import { messageReactions, messages, notifications, users } from "@/lib/db/schema";
import {
  listConversations,
  openConversation,
  openVoiceNote,
  sendMessage,
  sendSticker,
  sendVoiceNote,
  startConversation,
  toggleReaction,
  voiceType,
} from "@/modules/messages";
import { createCompany, createUser, db, expectDbError } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 34: stickers, voice notes, @mentions and reactions in messages.

beforeAll(() => vi.stubEnv("LOCAL_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "agod-voice-"))));

async function company() {
  const { owner } = await createCompany();
  const pm = await createUser("PROJECT_MANAGER", { orgId: owner.orgId });
  const ama = await createUser("TEAM_MEMBER", { orgId: owner.orgId });
  const kofi = await createUser("TEAM_MEMBER", { orgId: owner.orgId });
  const name = async (id: string, n: string) => db.update(users).set({ name: n }).where(eq(users.id, id));
  await name(ama.id, "Ama Mensah");
  await name(kofi.id, "Kofi Boateng");
  return { owner, pm, ama, kofi };
}

/** A tiny WebM header followed by padding: enough for the type check. */
const webm = (n = 2000) => {
  const b = new Uint8Array(n);
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return b;
};

describe("message extras", () => {
  it("@mentions notify the people tagged (only people in the conversation)", async () => {
    const { owner, pm, ama, kofi } = await company();
    const id = await startConversation(pm, { memberIds: [ama.id, kofi.id], title: "Shop launch" });
    await sendMessage(pm, id, { body: "@Ama Mensah can you check the login? cc @Kofi Boateng and @Owner" });
    const [m] = await db.select().from(messages).where(eq(messages.conversationId, id));
    expect(m.mentionedIds.sort()).toEqual([ama.id, kofi.id].sort());
    const n = await db.select().from(notifications).where(and(eq(notifications.recipientId, ama.id), eq(notifications.type, "message.mention")));
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ entityType: "conversation", entityId: id });
    expect(n[0].title).toContain("mentioned you in Shop launch");
    // The owner isn't in the conversation: no notification.
    expect(await db.select().from(notifications).where(and(eq(notifications.recipientId, owner.id), eq(notifications.type, "message.mention")))).toHaveLength(0);
  });

  it("stickers: only the built-in ones; shown in the list preview", async () => {
    const { pm, ama } = await company();
    const id = await startConversation(pm, { memberIds: [ama.id] });
    await expect(sendSticker(pm, id, "nope")).rejects.toThrow(/one of the stickers/);
    await sendSticker(pm, id, "ayekoo");
    const open = await openConversation(ama, id);
    expect(open!.messages[0]).toMatchObject({ kind: "STICKER", sticker: "ayekoo", body: "" });
    expect((await listConversations(ama))[0].lastMessage!.body).toBe("Sticker: 👏 Ayekoo!");
  });

  it("voice notes: checked, stored privately, playable only by the conversation's people", async () => {
    const { pm, ama, kofi } = await company();
    const id = await startConversation(pm, { memberIds: [ama.id] });
    expect(voiceType(webm())).toEqual({ mime: "audio/webm", ext: "webm" });
    await expect(sendVoiceNote(pm, id, { bytes: new Uint8Array(2000).fill(65), seconds: 5 })).rejects.toThrow(/isn't a recording/);
    await expect(sendVoiceNote(pm, id, { bytes: webm(), seconds: 0 })).rejects.toThrow(/too short/);
    await expect(sendVoiceNote(pm, id, { bytes: webm(), seconds: 121 })).rejects.toThrow(/at most 2 minutes/);
    await expect(sendVoiceNote(kofi, id, { bytes: webm(), seconds: 5 })).rejects.toThrow(/not found/);
    await sendVoiceNote(pm, id, { bytes: webm(), seconds: 12 });
    const msg = (await openConversation(ama, id))!.messages[0];
    expect(msg).toMatchObject({ kind: "VOICE", voiceSeconds: 12 });
    expect((await listConversations(ama))[0].lastMessage!.body).toBe("🎤 Voice note (0:12)");
    const file = await openVoiceNote(ama, msg.id);
    expect(file).toMatchObject({ mime: "audio/webm" });
    expect(file!.bytes.length).toBe(2000);
    expect(await openVoiceNote(kofi, msg.id)).toBeNull();
  });

  it("reactions: toggle, counted per emoji, only by people in the conversation", async () => {
    const { pm, ama, kofi } = await company();
    const id = await startConversation(pm, { memberIds: [ama.id], body: "Shipped the login page" });
    const msgId = (await openConversation(pm, id))!.messages[0].id;
    await expect(toggleReaction(ama, msgId, "🦄")).rejects.toThrow(/one of the reactions/);
    expect(await toggleReaction(ama, msgId, "🎉")).toBe(true);
    expect(await toggleReaction(pm, msgId, "🎉")).toBe(true);
    expect(await toggleReaction(ama, msgId, "🔥")).toBe(true);
    expect((await openConversation(pm, id))!.messages[0].reactions).toEqual([
      { emoji: "🎉", count: 2, mine: true, names: ["Ama Mensah", "You"] },
      { emoji: "🔥", count: 1, mine: false, names: ["Ama Mensah"] },
    ]);
    expect(await toggleReaction(ama, msgId, "🎉")).toBe(false);
    await expect(toggleReaction(kofi, msgId, "👍")).rejects.toThrow(/not found/);
    // The database refuses reactions on someone else's behalf or outside the conversation.
    await expectDbError(
      withActor(kofi, (tx) => tx.insert(messageReactions).values({ messageId: msgId, userId: kofi.id, emoji: "👍" })),
      /row-level security/,
    );
    await expectDbError(
      withActor(pm, (tx) => tx.insert(messageReactions).values({ messageId: msgId, userId: ama.id, emoji: "👍" })),
      /row-level security/,
    );
    // Someone else's reaction can't be removed by me.
    await withActor(pm, (tx) => tx.execute(sql`delete from message_reactions where message_id = ${msgId} and user_id = ${ama.id}`));
    expect((await openConversation(pm, id))!.messages[0].reactions.find((r) => r.emoji === "🔥")!.count).toBe(1);
  });

  it("the database keeps message kinds consistent", async () => {
    const { pm, ama } = await company();
    const id = await startConversation(pm, { memberIds: [ama.id] });
    await expectDbError(withActor(pm, (tx) => tx.insert(messages).values({ conversationId: id, authorId: pm.id, kind: "STICKER", body: "" })), /messages_sticker/);
    await expectDbError(
      withActor(pm, (tx) => tx.insert(messages).values({ conversationId: id, authorId: pm.id, kind: "VOICE", body: "", voiceKey: "x", voiceMime: "audio/webm", voiceSeconds: 500, voiceBytes: 10 })),
      /messages_voice/,
    );
    await expectDbError(withActor(pm, (tx) => tx.insert(messages).values({ conversationId: id, authorId: pm.id, body: " " })), /messages_body/);
  });
});
