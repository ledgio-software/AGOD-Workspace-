"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Mic, SendHorizontal, SmilePlus, Square, Sticker, X } from "lucide-react";
import { ActionForm, SubmitButton, inputClass } from "@/components/form";
import { cx } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { EMOJIS, MAX_VOICE_SECONDS, REACTIONS, STICKERS, formatDuration } from "@/modules/messages/catalog";

// Phase 34: the message box with emojis, stickers, voice notes and @-tagging, and the reactions
// under each message.

type FormAction = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

const iconButton = "grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-fg aria-pressed:bg-surface-muted aria-pressed:text-fg";

/** Inserts text at the cursor of a textarea and keeps the cursor after it. */
function insertAt(el: HTMLTextAreaElement, text: string, from = el.selectionStart, to = el.selectionEnd) {
  el.setRangeText(text, from, to, "end");
  el.focus();
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function Composer({
  action,
  sticker,
  voice,
  people,
}: {
  action: FormAction;
  sticker: (key: string) => Promise<ActionResult>;
  voice: ((form: FormData) => Promise<ActionResult>) | null;
  people: { id: string; name: string }[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [panel, setPanel] = useState<"emoji" | "sticker" | null>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = mention ? people.filter((p) => p.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : [];

  const onInput = () => {
    const el = ref.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const m = /(^|\s)@([\p{L}\p{N}._-]*(?: [\p{L}\p{N}._-]*)?)$/u.exec(before);
    setMention(m && people.length > 0 ? { query: m[2], start: el.selectionStart - m[2].length - 1 } : null);
  };

  const pick = (name: string) => {
    const el = ref.current;
    if (!el || !mention) return;
    insertAt(el, `@${name} `, mention.start, el.selectionStart);
    setMention(null);
  };

  return (
    <div className="space-y-2">
      {panel === "emoji" && (
        <div role="dialog" aria-label="Emojis" className="grid grid-cols-9 gap-1 rounded-lg border border-line bg-surface p-2 shadow-sm sm:grid-cols-12">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => ref.current && insertAt(ref.current, e)} className="rounded-md p-1 text-xl hover:bg-surface-muted" aria-label={`Add ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}
      {panel === "sticker" && (
        <div role="dialog" aria-label="Stickers" className="grid grid-cols-4 gap-2 rounded-lg border border-line bg-surface p-2 shadow-sm sm:grid-cols-8">
          {Object.entries(STICKERS).map(([key, s]) => (
            <button
              key={key}
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await sticker(key);
                  setError(result.ok ? null : result.error);
                  if (result.ok) setPanel(null);
                })
              }
              className="flex flex-col items-center gap-0.5 rounded-lg p-2 hover:bg-surface-muted disabled:opacity-50"
              aria-label={`Send sticker ${s.label}`}
            >
              <span className="text-3xl" aria-hidden>
                {s.emoji}
              </span>
              <span className="text-[11px] font-medium text-muted">{s.label}</span>
            </button>
          ))}
        </div>
      )}
      {mention && matches.length > 0 && (
        <ul role="listbox" aria-label="Tag someone" className="max-w-xs divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p.name);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
              >
                @{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ActionForm action={action} resetOnSuccess className="flex items-end gap-1.5">
        <div className="flex">
          <button type="button" className={iconButton} aria-label="Emojis" aria-pressed={panel === "emoji"} onClick={() => setPanel(panel === "emoji" ? null : "emoji")}>
            <SmilePlus className="size-5" aria-hidden />
          </button>
          <button type="button" className={iconButton} aria-label="Stickers" aria-pressed={panel === "sticker"} onClick={() => setPanel(panel === "sticker" ? null : "sticker")}>
            <Sticker className="size-5" aria-hidden />
          </button>
        </div>
        <label className="sr-only" htmlFor="message-body">
          Message
        </label>
        <textarea
          ref={ref}
          id="message-body"
          name="body"
          required
          maxLength={4000}
          rows={2}
          placeholder={people.length > 0 ? "Message (type @ to tag)" : "Message"}
          className={`${inputClass} min-h-11 flex-1 resize-y`}
          onInput={onInput}
          onBlur={() => window.setTimeout(() => setMention(null), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMention(null);
            if (e.key === "Enter" && mention && matches.length > 0) {
              e.preventDefault();
              pick(matches[0].name);
              return;
            }
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {voice && <VoiceRecorder send={voice} onError={setError} />}
        <SubmitButton pendingText="…">
          <SendHorizontal className="size-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">Send</span>
        </SubmitButton>
      </ActionForm>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** Pick a format the browser can record (WebM/Opus in most browsers, MP4 on Safari). */
function recordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
}

function VoiceRecorder({ send, onError }: { send: (form: FormData) => Promise<ActionResult>; onError: (message: string | null) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const cancelled = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const start = async () => {
    onError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("This browser can't record voice notes. Try Chrome, Edge, Firefox or Safari.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("Allow the microphone for this site to record a voice note.");
      return;
    }
    const type = recordingType();
    // A low bitrate keeps voice notes small on mobile data.
    const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    chunks.current = [];
    cancelled.current = false;
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) window.clearInterval(timer.current);
      const length = Math.max(1, Math.round((Date.now() - started.current) / 1000));
      if (cancelled.current) {
        setState("idle");
        return;
      }
      setState("sending");
      const form = new FormData();
      form.set("voice", new Blob(chunks.current, { type: rec.mimeType || type || "audio/webm" }), "voice-note");
      form.set("seconds", String(Math.min(length, MAX_VOICE_SECONDS)));
      const result = await send(form);
      onError(result.ok ? null : result.error);
      setState("idle");
    };
    recorder.current = rec;
    started.current = Date.now();
    setSeconds(0);
    rec.start(1000);
    setState("recording");
    timer.current = window.setInterval(() => {
      const s = Math.round((Date.now() - started.current) / 1000);
      setSeconds(s);
      if (s >= MAX_VOICE_SECONDS && rec.state === "recording") rec.stop();
    }, 250);
  };

  const stop = (cancel: boolean) => {
    cancelled.current = cancel;
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  if (state === "recording") {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1 dark:bg-red-950/40">
        <span className="size-2 animate-pulse rounded-full bg-red-600" aria-hidden />
        <span className="text-sm tabular-nums text-red-700 dark:text-red-300" aria-live="polite">
          {formatDuration(seconds)}
        </span>
        <button type="button" onClick={() => stop(true)} className={iconButton} aria-label="Cancel recording">
          <X className="size-4" aria-hidden />
        </button>
        <button type="button" onClick={() => stop(false)} className={cx(iconButton, "text-red-700 dark:text-red-300")} aria-label="Stop and send voice note">
          <Square className="size-4 fill-current" aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={start} disabled={state === "sending"} className={cx(iconButton, "disabled:opacity-50")} aria-label={state === "sending" ? "Sending voice note" : "Record a voice note"}>
      <Mic className={cx("size-5", state === "sending" && "animate-pulse")} aria-hidden />
    </button>
  );
}

export function ReactionBar({
  reactions,
  react,
  mine,
}: {
  reactions: { emoji: string; count: number; mine: boolean; names: string[] }[];
  react: (emoji: string) => Promise<ActionResult>;
  mine: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const toggle = (emoji: string) =>
    startTransition(async () => {
      await react(emoji);
      setOpen(false);
    });
  return (
    <div className={cx("mt-1 flex flex-wrap items-center gap-1", mine ? "justify-end" : "justify-start")}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={pending}
          onClick={() => toggle(r.emoji)}
          title={r.names.join(", ")}
          aria-label={`${r.emoji} ${r.count}: ${r.names.join(", ")}${r.mine ? " (tap to remove yours)" : ""}`}
          className={cx(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
            r.mine ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "border-line bg-surface text-muted",
          )}
        >
          <span>{r.emoji}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}
      {open ? (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface px-1 shadow-xs">
          {REACTIONS.map((e) => (
            <button key={e} type="button" disabled={pending} onClick={() => toggle(e)} className="rounded-full p-1 text-base hover:bg-surface-muted" aria-label={`React with ${e}`}>
              {e}
            </button>
          ))}
        </span>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="rounded-full p-1 text-muted opacity-60 hover:bg-surface-muted hover:opacity-100" aria-label="Add a reaction">
          <SmilePlus className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
