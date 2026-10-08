"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { cx } from "./ui";

// Phase 30: the message icon with the number of unread messages. Checks every 30 seconds while
// the page is visible (cheap: one small request), and again when the tab comes back.

export function MessagesLink({ initial, compact = false }: { initial: number; compact?: boolean }) {
  const [count, setCount] = useState(initial);
  const pathname = usePathname();

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/messages/unread", { cache: "no-store" });
        if (res.ok && !stopped) setCount((await res.json()).count ?? 0);
      } catch {
        // Offline or a slow network: try again next time.
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    // The Messages page says when it has shown (and so marked read) a conversation.
    window.addEventListener("messages:read", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("messages:read", check);
    };
  }, [pathname]);

  const label = count === 0 ? "Messages" : `Messages, ${count} unread`;
  return (
    <Link
      href="/messages"
      aria-label={label}
      title={label}
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-fg",
        compact ? "size-9" : "size-9 border border-line bg-surface shadow-xs",
      )}
    >
      <MessageCircle className="size-5" aria-hidden />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-semibold leading-5 text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
