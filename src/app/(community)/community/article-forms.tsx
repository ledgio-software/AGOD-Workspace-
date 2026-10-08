"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import { ImageInput } from "@/components/image-input";
import { cx } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { Markdown, readingMinutes } from "@/lib/markdown";

// Phase 37: forms for articles.

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

const HELP = `# Heading   ## Smaller heading
**bold**   _italic_   \`code\`   [link text](https://…)
- list item   1. numbered item   > quote
\`\`\` on its own line starts and ends a code block`;

export function ArticleEditor({
  action,
  defaults,
  published,
  coversOn,
  hasCover,
}: {
  action: Action;
  defaults?: { title: string; summary: string; body: string; tags: string };
  published: boolean;
  coversOn: boolean;
  hasCover: boolean;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [body, setBody] = useState(defaults?.body ?? "");
  return (
    <ActionForm action={action} className="space-y-4">
      <Field label="Title">
        <input name="title" required minLength={5} maxLength={150} defaultValue={defaults?.title} placeholder="e.g. How I added MoMo payments to my Lovable app" className={inputClass} />
      </Field>
      <Field label="Summary" hint="One or two sentences on what readers will learn. Shown on the feed.">
        <textarea name="summary" required minLength={10} maxLength={300} rows={2} defaultValue={defaults?.summary} className={inputClass} />
      </Field>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-fg">The article</span>
          <div role="tablist" aria-label="Editor" className="flex gap-1 rounded-lg bg-surface-muted p-1 text-xs">
            {(["write", "preview"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cx("rounded-md px-3 py-1 capitalize", tab === t ? "bg-surface font-medium text-fg shadow-xs" : "text-muted hover:text-fg")}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        {/* The textarea stays in the form while previewing, so its text is always sent. */}
        <textarea
          name="body"
          aria-label="The article"
          required
          minLength={50}
          maxLength={30000}
          rows={18}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onInvalid={() => setTab("write")}
          className={cx(inputClass, "font-mono text-sm", tab === "preview" && "hidden")}
        />
        {tab === "preview" && (
          <div className="min-h-64 rounded-lg border border-line bg-surface p-4">{body.trim() ? <Markdown source={body} /> : <p className="text-muted">Nothing to preview yet.</p>}</div>
        )}
        <p className="flex flex-wrap justify-between gap-2 text-xs text-muted">
          <span className="whitespace-pre-line font-mono">{HELP}</span>
          <span>
            About {readingMinutes(body)} min read · {body.length.toLocaleString("en-GB")} / 30,000
          </span>
        </p>
      </div>
      <Field label="Tags (optional)" hint="Up to 5, separated by commas, e.g. Lovable, Payments, Beginners.">
        <input name="tags" maxLength={200} defaultValue={defaults?.tags} className={inputClass} />
      </Field>
      {coversOn ? (
        <div className="space-y-2">
          <Field label={hasCover ? "Change the cover picture (optional)" : "Cover picture (optional)"} hint="PNG, JPG, WebP or GIF.">
            <ImageInput name="cover" />
          </Field>
          {hasCover && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="removeCover" /> Remove the cover picture
            </label>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">Cover pictures appear here once the organizers switch on picture uploads.</p>
      )}
      <p className="text-xs text-muted">Never include passwords, keys or anyone&apos;s personal data.</p>
      <div className="flex flex-wrap gap-2">
        {published ? (
          <SubmitButton>Save changes</SubmitButton>
        ) : (
          <>
            <button type="submit" name="intent" value="publish" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Publish
            </button>
            <button type="submit" name="intent" value="draft" className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium hover:bg-surface-muted">
              Save draft
            </button>
          </>
        )}
      </div>
    </ActionForm>
  );
}

export function CommentForm({ action, reply = false }: { action: Action; reply?: boolean }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-2">
      <textarea
        name="body"
        aria-label={reply ? "Your reply" : "Your comment"}
        required
        minLength={2}
        maxLength={2000}
        rows={reply ? 2 : 3}
        placeholder={reply ? "Write a reply" : "What did you think? Ask a question or add what you know."}
        className={inputClass}
      />
      <SubmitButton size="sm" pendingText="Posting…">
        {reply ? "Reply" : "Comment"}
      </SubmitButton>
    </ActionForm>
  );
}

export function RepostForm({ action, reposted }: { action: Action; reposted: boolean }) {
  return (
    <ActionForm action={action} className="space-y-2">
      {!reposted && (
        <Field label="Add a note (optional)">
          <input name="note" maxLength={280} placeholder="e.g. Read this before you add payments to your app." className={inputClass} />
        </Field>
      )}
      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
        {reposted ? "Take back my repost" : "Repost"}
      </SubmitButton>
    </ActionForm>
  );
}

export function ArticleReviewForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-2">
      <Field label="Your review" hint="Say what you checked, e.g. you followed the steps and they work, or the advice is safe.">
        <textarea name="note" required minLength={10} maxLength={500} rows={3} className={inputClass} />
      </Field>
      <SubmitButton size="sm" pendingText="Saving…">
        Mark as reviewed
      </SubmitButton>
    </ActionForm>
  );
}
