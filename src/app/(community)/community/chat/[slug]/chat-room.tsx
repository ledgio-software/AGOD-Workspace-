"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, CheckCircle2, CircleHelp, EyeOff, Flag, Hash, MessageSquareReply, SendHorizontal, SmilePlus, Trash2, X } from "lucide-react";
import { Avatar, cx } from "@/components/ui";
import { inputClass } from "@/components/input-class";
import type { ActionResult } from "@/lib/action-result";
import type { Channel, ChannelView, ChatMessage, ThreadView } from "@/modules/community/chat";
import { EMOJIS, REACTIONS } from "@/modules/messages/catalog";
import { deleteChatAction, hideChatAction, postChatAction, reactChatAction, reportChatAction, solveChatAction, suggestPeopleAction } from "../actions";

// Phase 36: the community chat, like Discord: channels on the left, the conversation in the
// middle, a thread on the right (full screen on a phone). Every few seconds the page asks whether
// anything changed and fetches only then.

const POLL_MS = 4000;
// Accra is on GMT all year. Written out by hand so the server and every browser show exactly the same text.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const time = { format: (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
const day = { format: (d: Date) => `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` };

/** Repeats `fn` while the tab is visible (and once right away when it becomes visible again). */
function usePoll(fn: () => void, ms: number) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  }, [fn]);
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && saved.current();
    const timer = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms]);
}

/** Links and @handles in a message. */
function Body({ text, removed }: { text: string; removed: boolean }) {
  if (removed) return <p className="italic text-muted">{text}</p>;
  const parts = text.split(/(https:\/\/[^\s<>"]+|(?<![\w@])@[a-z0-9][a-z0-9-]{1,39})/gi);
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        /^https:\/\//i.test(p) ? (
          <a key={i} href={p} target="_blank" rel="nofollow ugc noopener noreferrer" className="text-brand-600 underline dark:text-brand-400">
            {p}
          </a>
        ) : /^@[a-z0-9]/i.test(p) ? (
          <Link key={i} href={`/members/${p.slice(1).toLowerCase()}`} className="rounded bg-brand-50 px-0.5 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            {p}
          </Link>
        ) : (
          p
        ),
      )}
    </p>
  );
}

function MessageRow({
  m,
  kind,
  organizer,
  inThread,
  onChange,
  onOpenThread,
  onError,
}: {
  m: ChatMessage;
  kind: Channel["kind"];
  organizer: boolean;
  inThread: boolean;
  onChange: () => void;
  onOpenThread?: (id: string) => void;
  onError: (message: string | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>) =>
    start(async () => {
      const r = await fn();
      onError(r.ok ? null : r.error);
      if (r.ok) onChange();
    });
  const question = kind === "QUESTIONS" && !inThread;

  return (
    <li id={`m-${m.id}`} className={cx("group relative flex gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-muted/60", m.mentionsMe && !m.removed && "bg-amber-50 dark:bg-amber-400/10")}>
      <Avatar name={m.authorName} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          {m.authorHandle ? (
            <Link href={`/members/${m.authorHandle}`} className="font-semibold hover:underline">
              {m.authorName}
            </Link>
          ) : (
            <span className="font-semibold">{m.authorName}</span>
          )}
          <time className="text-xs text-muted" dateTime={m.createdAt} title={`${day.format(new Date(m.createdAt))} ${new Date(m.createdAt).getUTCFullYear()}, ${time.format(new Date(m.createdAt))}`}>
            {time.format(new Date(m.createdAt))}
          </time>
          {question && m.solved && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 text-xs font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
              <CheckCircle2 className="size-3" aria-hidden /> Solved
            </span>
          )}
        </p>
        <div className="text-sm">
          <Body text={m.body} removed={m.removed} />
        </div>
        {!m.removed && (m.reactions.length > 0 || picking) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                disabled={pending}
                onClick={() => run(() => reactChatAction(m.id, r.emoji))}
                title={r.names.join(", ")}
                aria-label={`${r.emoji} ${r.count}: ${r.names.join(", ")}`}
                className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", r.mine ? "border-brand-500 bg-brand-50 dark:bg-brand-950" : "border-line bg-surface")}
              >
                {r.emoji} <span className="tabular-nums">{r.count}</span>
              </button>
            ))}
            {picking && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface px-1 shadow-xs">
                {REACTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      setPicking(false);
                      run(() => reactChatAction(m.id, e));
                    }}
                    className="rounded-full p-1 hover:bg-surface-muted"
                    aria-label={`React with ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </span>
            )}
          </div>
        )}
        {!inThread && onOpenThread && !m.removed && (m.replyCount > 0 || question) && (
          <button type="button" onClick={() => onOpenThread(m.id)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
            <MessageSquareReply className="size-3.5" aria-hidden />
            {m.replyCount > 0 ? `${m.replyCount} ${m.replyCount === 1 ? "reply" : "replies"}` : "Answer"}
          </button>
        )}
        {reporting && (
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
              run(async () => {
                const r = await reportChatAction(m.id, reason);
                if (r.ok) setReporting(false);
                return r;
              });
            }}
          >
            <input name="reason" required minLength={10} maxLength={1000} placeholder="What's wrong with this message?" aria-label="Why you're reporting it" className={`${inputClass} flex-1`} />
            <button type="submit" className="rounded-lg bg-red-600 px-3 text-sm font-medium text-white">
              Report
            </button>
          </form>
        )}
      </div>
      {!m.removed && (
        <div className="absolute -top-3 right-2 hidden items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-sm group-focus-within:flex group-hover:flex">
          <button type="button" className="rounded p-1 text-muted hover:bg-surface-muted hover:text-fg" aria-label="Add a reaction" onClick={() => setPicking((v) => !v)}>
            <SmilePlus className="size-4" aria-hidden />
          </button>
          {!inThread && onOpenThread && (
            <button type="button" className="rounded p-1 text-muted hover:bg-surface-muted hover:text-fg" aria-label="Reply in thread" onClick={() => onOpenThread(m.id)}>
              <MessageSquareReply className="size-4" aria-hidden />
            </button>
          )}
          {question && (m.mine || organizer) && (
            <button type="button" className="rounded p-1 text-muted hover:bg-surface-muted hover:text-fg" aria-label={m.solved ? "Mark as not solved" : "Mark as solved"} onClick={() => run(() => solveChatAction(m.id, !m.solved))}>
              {m.solved ? <CircleHelp className="size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
            </button>
          )}
          {m.mine ? (
            <button
              type="button"
              className="rounded p-1 text-muted hover:bg-surface-muted hover:text-red-600"
              aria-label="Delete message"
              onClick={() => confirm("Delete this message?") && run(() => deleteChatAction(m.id))}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          ) : (
            <>
              <button type="button" className="rounded p-1 text-muted hover:bg-surface-muted hover:text-fg" aria-label="Report message" onClick={() => setReporting((v) => !v)}>
                <Flag className="size-4" aria-hidden />
              </button>
              {organizer && (
                <button type="button" className="rounded p-1 text-muted hover:bg-surface-muted hover:text-red-600" aria-label="Hide message" onClick={() => run(() => hideChatAction(m.id, true))}>
                  <EyeOff className="size-4" aria-hidden />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Composer({ placeholder, canPost, onSend }: { placeholder: string; canPost: boolean; onSend: (body: string) => Promise<ActionResult<string>> }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [emojis, setEmojis] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [people, setPeople] = useState<{ handle: string; name: string }[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!mention) return;
    const t = window.setTimeout(async () => setPeople(await suggestPeopleAction(mention.query)), 200);
    return () => window.clearTimeout(t);
  }, [mention]);

  if (!canPost) {
    return (
      <p className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-muted">
        Agree to the code of conduct on the{" "}
        <Link href="/community" className="font-medium underline">
          community home
        </Link>{" "}
        to take part.
      </p>
    );
  }

  const insert = (text: string, from?: number) => {
    const el = ref.current;
    if (!el) return;
    el.setRangeText(text, from ?? el.selectionStart, el.selectionEnd, "end");
    el.focus();
  };
  const send = () => {
    const el = ref.current;
    const body = el?.value.trim() ?? "";
    if (!el || !body) return;
    start(async () => {
      const r = await onSend(body);
      setError(r.ok ? null : r.error);
      if (r.ok) {
        el.value = "";
        setMention(null);
        setEmojis(false);
      }
    });
  };

  return (
    <div className="space-y-2">
      {emojis && (
        <div className="grid grid-cols-9 gap-1 rounded-lg border border-line bg-surface p-2 shadow-sm sm:grid-cols-12">
          {EMOJIS.map((e) => (
            <button key={e} type="button" className="rounded p-1 text-xl hover:bg-surface-muted" aria-label={`Add ${e}`} onClick={() => insert(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
      {mention && people.length > 0 && (
        <ul role="listbox" aria-label="Tag someone" className="max-w-xs divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          {people.map((p) => (
            <li key={p.handle}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const el = ref.current;
                  if (!el) return;
                  el.setRangeText(`@${p.handle} `, mention.start, el.selectionStart, "end");
                  el.focus();
                  setMention(null);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
              >
                <span className="font-medium">{p.name}</span> <span className="text-muted">@{p.handle}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-1.5">
        <button type="button" className="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-fg" aria-label="Emojis" aria-pressed={emojis} onClick={() => setEmojis((v) => !v)}>
          <SmilePlus className="size-5" aria-hidden />
        </button>
        <textarea
          ref={ref}
          rows={1}
          maxLength={2000}
          placeholder={placeholder}
          aria-label="Message"
          className={`${inputClass} max-h-40 min-h-10 flex-1 resize-y`}
          onInput={() => {
            const el = ref.current!;
            const m = /(^|\s)@([a-z0-9-]{0,30})$/i.exec(el.value.slice(0, el.selectionStart));
            setMention(m ? { query: m[2], start: el.selectionStart - m[2].length - 1 } : null);
          }}
          onBlur={() => window.setTimeout(() => setMention(null), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" disabled={pending} onClick={send} className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60" aria-label="Send">
          <SendHorizontal className="size-4" aria-hidden />
        </button>
      </div>
      <p className="text-[11px] text-muted">Enter to send · Shift+Enter for a new line · @ to tag someone</p>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function ChatRoom({
  initial,
  initialThread,
  initialChannels,
  organizer,
  canPost,
}: {
  initial: ChannelView;
  initialThread: ThreadView | null;
  initialChannels: Channel[];
  organizer: boolean;
  canPost: boolean;
}) {
  const [view, setView] = useState(initial);
  const [thread, setThread] = useState(initialThread);
  const [channels, setChannels] = useState(initialChannels);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const slug = view.channel.slug;

  const refreshChannel = useCallback(async () => {
    const res = await fetch(`/api/community/chat?channel=${slug}&known=${encodeURIComponent(view.version)}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.unchanged) setView(data);
  }, [slug, view.version]);
  const refreshThread = useCallback(async () => {
    if (!thread) return;
    const res = await fetch(`/api/community/chat?thread=${thread.parent.id}&known=${encodeURIComponent(thread.version)}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.unchanged) setThread(data);
  }, [thread]);
  const refreshChannels = useCallback(async () => {
    const res = await fetch(`/api/community/chat?channels=1`, { cache: "no-store" });
    if (res.ok) setChannels((await res.json()).channels);
  }, []);

  usePoll(() => {
    void refreshChannel();
    void refreshThread();
  }, POLL_MS);
  usePoll(() => void refreshChannels(), POLL_MS * 4);

  // Keep the newest message in view when new ones arrive (unless reading older ones).
  const count = view.messages.length;
  const last = view.messages.at(-1)?.id;
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 200;
    if (nearBottom || older.length === 0) endRef.current?.scrollIntoView({ block: "end" });
  }, [count, last, older.length]);

  const openThread = async (id: string) => {
    const res = await fetch(`/api/community/chat?thread=${id}`, { cache: "no-store" });
    if (!res.ok) return;
    setThread(await res.json());
    window.history.replaceState(null, "", `/community/chat/${slug}?thread=${id}`);
  };
  const closeThread = () => {
    setThread(null);
    window.history.replaceState(null, "", `/community/chat/${slug}`);
  };
  const loadOlder = async () => {
    const first = (older[0] ?? view.messages[0])?.createdAt;
    if (!first) return;
    const res = await fetch(`/api/community/chat?channel=${slug}&before=${encodeURIComponent(first)}`, { cache: "no-store" });
    if (!res.ok) return;
    const data: ChannelView = await res.json();
    setOlder([...data.messages, ...older]);
    setHasMore(data.hasMore);
  };
  const refreshAll = () => {
    void refreshChannel();
    void refreshThread();
  };

  const messages = [...older, ...view.messages];
  const question = view.channel.kind === "QUESTIONS";

  return (
    <div className="grid h-[calc(100dvh-9rem)] min-h-[28rem] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl border border-line bg-surface shadow-xs lg:grid-cols-[13rem_minmax(0,1fr)_auto] lg:grid-rows-[minmax(0,1fr)]">
      {/* Channels */}
      <nav aria-label="Channels" className={cx("min-w-0 border-line lg:overflow-y-auto lg:border-r", thread ? "hidden lg:block" : "border-b lg:border-b-0")}>
        <p className="hidden px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted lg:block">Channels</p>
        <ul className="flex gap-1 overflow-x-auto p-2 lg:block lg:space-y-0.5 lg:overflow-visible">
          {channels.map((c) => (
            <li key={c.id} className="shrink-0">
              <Link
                href={`/community/chat/${c.slug}`}
                className={cx(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm",
                  c.slug === slug ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300" : c.unread > 0 ? "font-semibold text-fg hover:bg-surface-muted" : "text-muted hover:bg-surface-muted hover:text-fg",
                )}
              >
                {c.kind === "QUESTIONS" ? <CircleHelp className="size-4 shrink-0" aria-hidden /> : <Hash className="size-4 shrink-0" aria-hidden />}
                <span className="truncate">{c.name}</span>
                {c.mentions > 0 ? (
                  <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white" aria-label={`${c.mentions} mentions`}>
                    @{c.mentions}
                  </span>
                ) : c.unread > 0 && c.slug !== slug ? (
                  <span className="ml-auto size-2 rounded-full bg-fg" aria-label="New messages" />
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Channel */}
      <section className={cx("flex min-h-0 min-w-0 flex-col", thread && "hidden lg:flex")} aria-label={`#${view.channel.name}`}>
        <header className="border-b border-line px-4 py-3">
          <h1 className="flex items-center gap-1.5 font-semibold">
            {question ? <CircleHelp className="size-4 text-muted" aria-hidden /> : <Hash className="size-4 text-muted" aria-hidden />}
            {view.channel.name}
          </h1>
          <p className="text-xs text-muted">{view.channel.description}</p>
        </header>
        <ul ref={listRef} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-3" aria-live="polite">
          {hasMore && (
            <li className="pb-2 text-center">
              <button type="button" onClick={loadOlder} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                Show older messages
              </button>
            </li>
          )}
          {messages.length === 0 && <li className="px-2 py-8 text-center text-sm text-muted">{question ? "No questions yet. Ask the first one." : "No messages yet. Say hello!"}</li>}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || day.format(new Date(prev.createdAt)) !== day.format(new Date(m.createdAt));
            return (
              <div key={m.id}>
                {newDay && (
                  <p className="my-2 flex items-center gap-2 text-[11px] font-medium text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
                    {day.format(new Date(m.createdAt))}
                  </p>
                )}
                <MessageRow m={m} kind={view.channel.kind} organizer={organizer} inThread={false} onChange={refreshAll} onOpenThread={openThread} onError={setError} />
              </div>
            );
          })}
          <div ref={endRef} />
        </ul>
        <div className="border-t border-line p-3">
          {error && (
            <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <Composer
            canPost={canPost}
            placeholder={question ? "Ask a question: what you tried and what happened" : `Message #${view.channel.name}`}
            onSend={async (body) => {
              const r = await postChatAction(slug, null, body);
              if (r.ok) await refreshChannel();
              return r;
            }}
          />
        </div>
      </section>

      {/* Thread */}
      {thread && (
        <aside className="row-span-2 flex min-h-0 min-w-0 flex-col border-line lg:row-span-1 lg:w-[24rem] lg:border-l" aria-label="Thread">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <button type="button" onClick={closeThread} className="rounded p-1 text-muted hover:bg-surface-muted lg:hidden" aria-label="Back to the channel">
              <ArrowLeft className="size-4" aria-hidden />
            </button>
            <h2 className="flex-1 font-semibold">{question ? "Question" : "Thread"}</h2>
            <button type="button" onClick={closeThread} className="hidden rounded p-1 text-muted hover:bg-surface-muted lg:block" aria-label="Close thread">
              <X className="size-4" aria-hidden />
            </button>
          </header>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
            <MessageRow m={thread.parent} kind={thread.channelKind} organizer={organizer} inThread={false} onChange={refreshAll} onError={setError} />
            <li className="my-2 flex items-center gap-2 px-2 text-[11px] text-muted after:h-px after:flex-1 after:bg-line">
              {thread.replies.length} {thread.replies.length === 1 ? "reply" : "replies"}
            </li>
            {thread.replies.map((r) => (
              <MessageRow key={r.id} m={r} kind={thread.channelKind} organizer={organizer} inThread onChange={refreshAll} onError={setError} />
            ))}
          </ul>
          {!thread.parent.removed && (
            <div className="border-t border-line p-3">
              <Composer
                canPost={canPost}
                placeholder={question ? "Write an answer" : "Reply"}
                onSend={async (body) => {
                  const r = await postChatAction(thread.channelSlug, thread.parent.id, body);
                  if (r.ok) refreshAll();
                  return r;
                }}
              />
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
