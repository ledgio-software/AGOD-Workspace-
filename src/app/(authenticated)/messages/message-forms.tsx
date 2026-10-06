"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionForm, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

// Phase 30: the message box, the new-conversation form, and keeping an open conversation fresh.

type Action<T = undefined> = (prev: ActionResult<T> | null, form: FormData) => Promise<ActionResult<T>>;

/** Re-reads the page every 10 seconds while it's visible, so new messages appear. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && router.refresh();
    const timer = window.setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);
  return null;
}

/** Keeps the newest message in view, and tells the message icon the conversation was read. */
export function ScrollToEnd({ count, conversationId }: { count: number; conversationId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
    window.dispatchEvent(new Event("messages:read"));
  }, [count, conversationId]);
  return <div ref={ref} />;
}

export function Composer({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex items-end gap-2">
      <label className="sr-only" htmlFor="message-body">
        Message
      </label>
      <textarea
        id="message-body"
        name="body"
        required
        maxLength={4000}
        rows={2}
        placeholder="Write a message… (Ctrl+Enter to send)"
        className={`${inputClass} min-h-11 flex-1 resize-y`}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <SubmitButton pendingText="Sending…">Send</SubmitButton>
    </ActionForm>
  );
}

export function NewConversationForm({ action, people, preselected }: { action: Action<string>; people: { id: string; name: string; email: string }[]; preselected: string[] }) {
  const [chosen, setChosen] = useState<string[]>(preselected);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? people.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) : people;
  }, [people, query]);
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Who to message</p>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" aria-label="Search people" className={inputClass} />
        <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {shown.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-muted">
                <input
                  type="checkbox"
                  name="memberIds"
                  value={p.id}
                  checked={chosen.includes(p.id)}
                  onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted">{p.email}</span>
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nobody matches.</li>}
        </ul>
        {chosen.length > 1 && <p className="text-xs text-muted">{chosen.length} people: this will be a group conversation (up to 9 others).</p>}
      </div>
      {chosen.length > 1 && (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Group name (optional)</span>
          <input name="title" maxLength={80} placeholder="e.g. Shop launch team" className={inputClass} />
        </label>
      )}
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Message</span>
        <textarea name="body" rows={3} maxLength={4000} className={inputClass} />
      </label>
      <SubmitButton pendingText="Starting…">{chosen.length > 1 ? "Start group conversation" : "Send"}</SubmitButton>
    </ActionForm>
  );
}
