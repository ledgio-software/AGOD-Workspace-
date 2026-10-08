import { redirect } from "next/navigation";

// Phase 36: the chat opens on #general.
export default function ChatHome() {
  redirect("/community/chat/general");
}
