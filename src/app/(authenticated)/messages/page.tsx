import Link from "next/link";
import { ArrowLeft, Lock, MessageCircle, Plus, Users } from "lucide-react";
import { Avatar, Card, EmptyState, PageHeader, buttonClass, cx } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { requireUser } from "@/lib/session";
import { listConversations, messageablePeople, openConversation, voiceNotesAvailable } from "@/modules/messages";
import { STICKERS, formatDuration, isSticker } from "@/modules/messages/catalog";
import { reactAction, sendMessageAction, sendStickerAction, sendVoiceAction, startConversationAction } from "./actions";
import { Composer, ReactionBar } from "./composer";
import { AutoRefresh, NewConversationForm, ScrollToEnd } from "./message-forms";

/** Shows "@Name" for people in the conversation in bold (and highlighted when it's me). */
function withMentions(body: string, people: { id: string; name: string }[], me: string, mine: boolean) {
  const names = people.map((p) => p.name).filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
  if (names.length === 0 || !body.includes("@")) return body;
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`@(${names.map(escape).join("|")})(?![\\p{L}\\p{N}._-])`, "giu");
  const meName = people.find((p) => p.id === me)?.name.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(pattern)) {
    parts.push(body.slice(last, m.index));
    const isMe = m[1].toLowerCase() === meName;
    parts.push(
      <span key={m.index} className={cx("font-semibold", isMe && (mine ? "underline" : "rounded bg-amber-100 px-0.5 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200"))}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  parts.push(body.slice(last));
  return parts;
}

// Phase 30: messages between people of this company. The list on the left, the open conversation
// (or a new one) on the right; on a phone, one at a time.

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ c?: string; new?: string; to?: string }> }) {
  const actor = await requireUser();
  const params = await searchParams;
  const starting = params.new === "1" || !!params.to;
  const [list, open, people] = await Promise.all([
    listConversations(actor),
    params.c && !starting ? openConversation(actor, params.c) : Promise.resolve(null),
    starting ? messageablePeople(actor) : Promise.resolve([]),
  ]);
  // Opening a conversation marks it read: show the list as it is now.
  const conversations = open ? list.map((c) => (c.id === open.id ? { ...c, unread: 0 } : c)) : list;
  const showingRight = starting || !!open;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Team"
        title="Messages"
        description="Private conversations with people in this company. Only the people in a conversation can read it."
        actions={
          <Link href="/messages?new=1" className={buttonClass("primary")}>
            <Plus className="size-4" aria-hidden /> New message
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <Card className={cx(showingRight && "hidden lg:block")} bodyClassName="p-0">
          {conversations.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={MessageCircle} title="No conversations yet">
                Start one with <strong>New message</strong>, or from someone&apos;s name on the Team page.
              </EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/messages?c=${c.id}`}
                    className={cx("flex items-start gap-3 px-4 py-3 hover:bg-surface-muted", open?.id === c.id && "bg-brand-50 dark:bg-brand-950/40")}
                  >
                    {c.isGroup ? (
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-muted">
                        <Users className="size-4" aria-hidden />
                      </span>
                    ) : (
                      <Avatar name={c.title} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cx("truncate text-sm", c.unread > 0 ? "font-semibold" : "font-medium")}>{c.title}</span>
                        {c.unread > 0 && (
                          <span className="grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-semibold leading-5 text-white" aria-label={`${c.unread} unread`}>
                            {c.unread}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {c.lastMessage ? `${c.lastMessage.mine ? "You" : c.lastMessage.authorName.split(/\s+/)[0]}: ${c.lastMessage.body}` : "No messages yet"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className={cx(!showingRight && "hidden lg:block")}>
          {starting ? (
            <Card
              title="New message"
              aside={
                <Link href="/messages" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg lg:hidden">
                  <ArrowLeft className="size-4" aria-hidden /> Back
                </Link>
              }
            >
              {people.length === 0 ? (
                <p className="text-sm text-muted">Nobody else is in this company yet.</p>
              ) : (
                <NewConversationForm action={startConversationAction} people={people} preselected={params.to && people.some((p) => p.id === params.to) ? [params.to] : []} />
              )}
            </Card>
          ) : open ? (
            <Card
              title={open.title}
              description={open.isGroup ? open.people.map((p) => (p.id === actor.id ? "you" : p.name)).join(", ") : undefined}
              aside={
                <Link href="/messages" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg lg:hidden">
                  <ArrowLeft className="size-4" aria-hidden /> All
                </Link>
              }
              bodyClassName="p-0"
            >
              <AutoRefresh />
              <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
                {open.truncated && <p className="text-center text-xs text-muted">Showing the latest 100 messages.</p>}
                {open.messages.length === 0 && <p className="text-sm text-muted">No messages yet. Say hello.</p>}
                {open.messages.map((m) => {
                  const mine = m.authorId === actor.id;
                  const sticker = m.kind === "STICKER" && m.sticker && isSticker(m.sticker) ? STICKERS[m.sticker] : null;
                  return (
                    <div key={m.id} className={cx("flex flex-col", mine ? "items-end" : "items-start")}>
                      {sticker ? (
                        <div className="max-w-[85%] px-1 text-center" data-kind="sticker">
                          {!mine && open.isGroup && <p className="text-left text-xs font-semibold">{m.authorName}</p>}
                          <p className="text-6xl leading-tight" aria-hidden>
                            {sticker.emoji}
                          </p>
                          <p className="text-sm font-semibold">{sticker.label}</p>
                          <p className="text-[11px] text-muted">{formatDateTime(m.createdAt)}</p>
                        </div>
                      ) : (
                        <div className={cx("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm", mine ? "bg-brand-600 text-white" : "bg-surface-muted text-fg")}>
                          {!mine && open.isGroup && <p className="text-xs font-semibold">{m.authorName}</p>}
                          {m.kind === "VOICE" ? (
                            <div className="space-y-1 py-1" data-kind="voice">
                              <audio controls preload="none" src={`/messages/voice/${m.id}`} className="h-10 w-60 max-w-full">
                                <a href={`/messages/voice/${m.id}`}>Play the voice note</a>
                              </audio>
                              <p className={cx("text-xs", mine ? "text-white/80" : "text-muted")}>🎤 Voice note · {formatDuration(m.voiceSeconds ?? 0)}</p>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{withMentions(m.body, open.people, actor.id, mine)}</p>
                          )}
                          <p className={cx("mt-1 text-[11px]", mine ? "text-white/70" : "text-muted")}>{formatDateTime(m.createdAt)}</p>
                        </div>
                      )}
                      <ReactionBar reactions={m.reactions} react={reactAction.bind(null, m.id)} mine={mine} />
                    </div>
                  );
                })}
                <ScrollToEnd count={open.messages.length} conversationId={open.id} />
              </div>
              <div className="border-t border-line p-4">
                <Composer
                  action={sendMessageAction.bind(null, open.id)}
                  sticker={sendStickerAction.bind(null, open.id)}
                  voice={voiceNotesAvailable() ? sendVoiceAction.bind(null, open.id) : null}
                  people={open.people.filter((p) => p.id !== actor.id)}
                />
                <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted">
                  <Lock className="size-3" aria-hidden /> Only the people in this conversation can read it. Don&apos;t share passwords or payout amounts here.
                </p>
              </div>
            </Card>
          ) : params.c ? (
            <Card>
              <p className="text-sm text-muted">That conversation isn&apos;t available to you.</p>
            </Card>
          ) : (
            <Card>
              <EmptyState icon={MessageCircle} title="Choose a conversation">
                Or start a new one.
              </EmptyState>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
