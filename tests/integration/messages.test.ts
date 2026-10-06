import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { memberships, messages, notifications } from "@/lib/db/schema";
import {
  listConversations,
  messageablePeople,
  openConversation,
  refreshMessageAlert,
  sendMessage,
  startConversation,
  unreadMessageCount,
} from "@/modules/messages";
import { createCompany, createUser, db, expectDbError } from "./fixtures";

// Phase 30: in-app messages.

async function company() {
  const { owner } = await createCompany();
  const pm = await createUser("PROJECT_MANAGER", { orgId: owner.orgId });
  const ama = await createUser("TEAM_MEMBER", { orgId: owner.orgId });
  const kofi = await createUser("TEAM_MEMBER", { orgId: owner.orgId });
  return { owner, pm, ama, kofi };
}

describe("conversations", () => {
  it("one-to-one: reused, unread counts, read when opened", async () => {
    const { pm, ama } = await company();
    const id = await startConversation(pm, { memberIds: [ama.id], body: "Hi Ama, can you take the API task?" });
    expect(await startConversation(ama, { memberIds: [pm.id] })).toBe(id);
    expect(await unreadMessageCount(ama)).toBe(1);
    const [summary] = await listConversations(ama);
    expect(summary).toMatchObject({ id, unread: 1, isGroup: false, lastMessage: { body: "Hi Ama, can you take the API task?", mine: false } });
    const opened = await openConversation(ama, id);
    expect(opened!.messages.map((m) => m.body)).toEqual(["Hi Ama, can you take the API task?"]);
    expect(await unreadMessageCount(ama)).toBe(0);
    await sendMessage(ama, id, { body: "Yes, on it." });
    expect(await unreadMessageCount(pm)).toBe(1);
    expect(await unreadMessageCount(ama)).toBe(0);
  });

  it("groups have a name and up to 10 people", async () => {
    const { owner, pm, ama, kofi } = await company();
    const id = await startConversation(pm, { memberIds: [ama.id, kofi.id, owner.id], title: "Shop launch", body: "Kick-off at 10" });
    const [c] = await listConversations(kofi);
    expect(c).toMatchObject({ id, title: "Shop launch", isGroup: true });
    expect(c.people).toHaveLength(4);
    await expect(startConversation(pm, { memberIds: Array.from({ length: 10 }, () => crypto.randomUUID()) })).rejects.toThrow(/at most 10/);
  });

  it("only the people in a conversation can read it, Admins included", async () => {
    const { owner, pm, ama } = await company();
    const id = await startConversation(pm, { memberIds: [ama.id], body: "Private note about the client" });
    expect(await openConversation(owner, id)).toBeNull();
    expect(await listConversations(owner)).toEqual([]);
    const visible = await withActor(owner, (tx) => tx.select().from(messages).where(eq(messages.conversationId, id)));
    expect(visible).toHaveLength(0);
    await expect(sendMessage(owner, id, { body: "Let me in" })).rejects.toThrow(/not found/);
    // The database refuses it on its own, and nobody writes as someone else.
    await expectDbError(
      withActor(owner, (tx) => tx.insert(messages).values({ conversationId: id, authorId: owner.id, body: "hi" })),
      /row-level security/,
    );
    await expectDbError(
      withActor(ama, (tx) => tx.insert(messages).values({ conversationId: id, authorId: pm.id, body: "fake" })),
      /row-level security/,
    );
  });

  it("stays inside the company and with active people", async () => {
    const a = await company();
    const b = await company();
    await expect(startConversation(a.pm, { memberIds: [b.ama.id] })).rejects.toThrow(/active member of this company/);
    expect((await messageablePeople(a.pm)).map((p) => p.id)).not.toContain(b.ama.id);
    const id = await startConversation(a.pm, { memberIds: [a.kofi.id], body: "Bye Kofi" });
    await db.update(memberships).set({ active: false }).where(and(eq(memberships.userId, a.kofi.id), eq(memberships.organizationId, a.pm.orgId)));
    await expect(startConversation(a.pm, { memberIds: [a.kofi.id] })).rejects.toThrow(/active member/);
    await expect(sendMessage(a.pm, id, { body: "Still there?" })).rejects.toThrow(/Nobody else/);
    expect((await messageablePeople(a.pm)).map((p) => p.id)).not.toContain(a.kofi.id);
  });
});

describe("daily reminder", () => {
  it("one notification a day for messages unread over an hour", async () => {
    const { pm, ama } = await company();
    const id = await startConversation(pm, { memberIds: [ama.id], body: "Are you free tomorrow?" });
    const now = new Date();
    expect(await refreshMessageAlert(ama, now)).toBe(0); // less than an hour old
    const later = new Date(now.getTime() + 2 * 3_600_000);
    expect(await refreshMessageAlert(ama, later)).toBe(1);
    expect(await refreshMessageAlert(ama, later)).toBe(0); // once a day
    const [n] = await db.select().from(notifications).where(and(eq(notifications.recipientId, ama.id), eq(notifications.type, "messages.unread")));
    expect(n).toMatchObject({ title: "You have an unread message", entityType: "conversation", entityId: id });
    await openConversation(ama, id);
    expect(await refreshMessageAlert(ama, new Date(later.getTime() + 86_400_000))).toBe(0);
  });
});
