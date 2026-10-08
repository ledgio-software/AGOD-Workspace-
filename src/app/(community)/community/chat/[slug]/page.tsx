import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/session";
import { canModerate, ensureProfile } from "@/modules/community";
import { listChannels, openChannel, openThread } from "@/modules/community/chat";
import { ChatRoom } from "./chat-room";

export const metadata: Metadata = { title: "Chat" };

// Phase 36: community chat. The page loads the channel (and an open thread); the chat then keeps
// itself up to date in the browser.

export default async function ChatChannelPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ thread?: string }> }) {
  const { member } = await requireMember();
  const { slug } = await params;
  const { thread: threadId } = await searchParams;
  const view = await openChannel(member, slug);
  if (!view || view === "unchanged") notFound();
  const [channels, organizer, profile, thread] = await Promise.all([
    listChannels(member),
    canModerate(member),
    ensureProfile(member),
    threadId ? openThread(member, threadId) : Promise.resolve(null),
  ]);
  const openedThread = thread && thread !== "unchanged" && thread.channelSlug === slug ? thread : null;
  return <ChatRoom key={slug} initial={view} initialThread={openedThread} initialChannels={channels} organizer={organizer} canPost={!!profile.conductAcceptedAt} />;
}
