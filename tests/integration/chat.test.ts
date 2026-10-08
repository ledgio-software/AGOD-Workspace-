import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { chatMessages, memberProfiles, users } from "@/lib/db/schema";
import { type Member, acceptConduct, ensureProfile, listReports, resolveReport } from "@/modules/community";
import {
  deleteMessage,
  listChannels,
  mentionSuggestions,
  openChannel,
  openThread,
  postMessage,
  reactToMessage,
  reportMessage,
  setHidden,
  setSolved,
} from "@/modules/community/chat";
import { db } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 36: community chat channels.

async function member(name: string, conduct = true): Promise<Member & { handle: string }> {
  const id = randomUUID();
  const m = { id, name, email: `${id}@agod.test` };
  await db.insert(users).values({ ...m, emailVerified: true });
  const p = await ensureProfile(m);
  if (conduct) await acceptConduct(m);
  return { ...m, handle: p.handle };
}

const opened = async (m: Member, slug: string, known?: string) => {
  const v = await openChannel(m, slug, { known });
  if (!v || v === "unchanged") throw new Error(`channel ${slug}: ${v}`);
  return v;
};

describe("community chat", () => {
  it("channels exist; posting needs the code of conduct; unread counts and @mentions", async () => {
    const ama = await member("Ama Chat");
    const kofi = await member("Kofi Chat");
    const newcomer = await member("New Person", false);
    expect((await listChannels(ama)).map((c) => c.slug)).toEqual(["general", "help", "ai-tools", "show-and-tell", "jobs-and-gigs", "off-topic"]);
    await expect(postMessage(newcomer, "general", { body: "hello" })).rejects.toThrow(/code of conduct/);
    await expect(postMessage(ama, "nope", { body: "hello" })).rejects.toThrow(/Channel not found/);

    await opened(kofi, "ai-tools");
    const id = await postMessage(ama, "ai-tools", { body: `Has anyone tried the new Cursor agent? @${kofi.handle} you mentioned it` });
    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    expect(row.mentionedIds).toEqual([kofi.id]);
    const kofiChannels = await listChannels(kofi);
    expect(kofiChannels.find((c) => c.slug === "ai-tools")).toMatchObject({ unread: 1, mentions: 1 });
    const view = await opened(kofi, "ai-tools");
    expect(view.messages.at(-1)).toMatchObject({ id, authorName: "Ama Chat", mentionsMe: true, mine: false });
    expect((await listChannels(kofi)).find((c) => c.slug === "ai-tools")).toMatchObject({ unread: 0, mentions: 0 });

    // Open pages ask "anything new?" and only fetch when something changed.
    expect(await openChannel(kofi, "ai-tools", { known: view.version })).toBe("unchanged");
    await reactToMessage(kofi, id, "🔥");
    const after = await opened(kofi, "ai-tools", view.version);
    expect(after.messages.find((m) => m.id === id)!.reactions).toEqual([{ emoji: "🔥", count: 1, mine: true, names: ["You"] }]);

    expect((await mentionSuggestions(ama, "kofi chat")).map((s) => s.handle)).toContain(kofi.handle);
  });

  it("threads, solving questions, deleting, hiding and reports", async () => {
    const asker = await member("Asker");
    const helper = await member("Helper");
    const org = await member("Organizer Chat");
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", org.email);

    const q = await postMessage(asker, "help", { body: "My Supabase login keeps logging people out. Why?" });
    await postMessage(helper, "help", { body: "Check the session expiry in your auth settings." }, q);
    await postMessage(asker, "help", { body: "That was it, thanks!" }, q);
    const thread = await openThread(helper, q);
    if (!thread || thread === "unchanged") throw new Error("no thread");
    expect(thread.parent.replyCount).toBe(2);
    expect(thread.replies.map((r) => r.authorName)).toEqual(["Helper", "Asker"]);
    expect(await openThread(helper, q, thread.version)).toBe("unchanged");

    await expect(setSolved(helper, q, true)).rejects.toThrow(/person who asked/);
    await setSolved(asker, q, true);
    expect((await opened(helper, "help")).messages.find((m) => m.id === q)!.solved).toBe(true);
    const general = await postMessage(asker, "general", { body: "Hello everyone" });
    await expect(setSolved(asker, general, true)).rejects.toThrow(/Only questions/);

    // Replies can't go into a deleted message's thread; the thread stays readable.
    const mine = await postMessage(helper, "general", { body: "Oops, wrong channel" });
    await expect(deleteMessage(asker, mine)).rejects.toThrow(/your own/);
    await deleteMessage(helper, mine);
    const shown = (await opened(asker, "general")).messages.find((m) => m.id === mine)!;
    expect(shown).toMatchObject({ removed: true, body: "This message was deleted." });
    await expect(postMessage(asker, "general", { body: "reply" }, mine)).rejects.toThrow(/isn't there/);

    // Reports go to the organizers, who can hide the message.
    const rude = await postMessage(helper, "off-topic", { body: "Something rude" });
    await expect(reportMessage(helper, rude, { reason: "Reporting myself for testing" })).rejects.toThrow(/your own/);
    await reportMessage(asker, rude, { reason: "This message is rude to members" });
    const report = (await listReports(org)).find((r) => r.target_type === "CHAT" && r.target_link?.includes(rude))!;
    expect(report.target_name).toBe("Message by Helper in #off-topic");
    await resolveReport(org, report.id, { action: "HIDE", note: "Not kind" });
    expect((await opened(asker, "off-topic")).messages.find((m) => m.id === rude)).toMatchObject({ removed: true, body: "This message was hidden by the organizers." });
    expect((await opened(org, "off-topic")).messages.find((m) => m.id === rude)!.body).toBe("Something rude");
    await expect(setHidden(asker, general, true)).rejects.toThrow(/organizers/);
    await setHidden(org, rude, false);
  });

  it("slows down people who post very fast", async () => {
    const fast = await member("Fast Typer");
    for (let i = 0; i < 20; i++) await postMessage(fast, "off-topic", { body: `message ${i}` });
    await expect(postMessage(fast, "off-topic", { body: "one more" })).rejects.toThrow(/very fast/);
    // Handles are matched case-insensitively.
    const [p] = await db.select({ handle: memberProfiles.handle }).from(memberProfiles).where(eq(memberProfiles.userId, fast.id));
    expect(p.handle).toBe(fast.handle);
  });
});
