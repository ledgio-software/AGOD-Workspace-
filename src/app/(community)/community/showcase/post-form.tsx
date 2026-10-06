"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import { ImageInput } from "@/components/image-input";
import type { ActionResult } from "@/lib/action-result";
import { FEEDBACK_AREAS, NEEDS, videoHost } from "@/modules/community/showcase-labels";
import { type CardData, PostCardView } from "../../../(public)/showcase/post-card";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export type PostDefaults = {
  title: string;
  pitch: string;
  audience: string | null;
  builtWith: string[];
  aiBuilt: boolean;
  liveUrl: string | null;
  repoUrl: string | null;
  videoUrl: string | null;
  feedbackAreas: string[];
  feedbackWanted: string | null;
  stuckOn: string | null;
  needs: string[];
  visibility: string;
};

export const EMPTY_POST: PostDefaults = {
  title: "",
  pitch: "",
  audience: null,
  builtWith: [],
  aiBuilt: false,
  liveUrl: null,
  repoUrl: null,
  videoUrl: null,
  feedbackAreas: [],
  feedbackWanted: null,
  stuckOn: null,
  needs: ["FEEDBACK"],
  visibility: "PUBLIC",
};

/**
 * The handbook's posting template, with a live preview of the showcase card (and, for new posts,
 * the first screenshot).
 */
export function PostForm({
  action,
  defaults,
  authorName,
  withScreenshot,
  submitLabel,
}: {
  action: Action;
  defaults: PostDefaults;
  authorName: string;
  withScreenshot: boolean;
  submitLabel: string;
}) {
  const [preview, setPreview] = useState<CardData>({
    id: "preview",
    title: defaults.title,
    pitch: defaults.pitch,
    builtWith: defaults.builtWith,
    aiBuilt: defaults.aiBuilt,
    status: "NEEDS_REVIEW",
    authorName,
    reviews: 0,
    image: null,
  });
  const [video, setVideo] = useState(defaults.videoUrl ?? "");
  const imageUrl = useRef<string | null>(null);
  useEffect(() => () => void (imageUrl.current && URL.revokeObjectURL(imageUrl.current)), []);

  function onInput(event: React.FormEvent<HTMLDivElement>) {
    const form = (event.target as HTMLElement).closest("form");
    if (!form) return;
    const data = new FormData(form);
    const file = data.get("screenshot");
    let image = preview.image;
    if ((event.target as HTMLInputElement).name === "screenshot") {
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
      imageUrl.current = file instanceof File && file.size > 0 && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      image = imageUrl.current;
    }
    setPreview((p) => ({
      ...p,
      title: String(data.get("title") ?? "").trim(),
      pitch: String(data.get("pitch") ?? "").trim(),
      builtWith: String(data.get("builtWith") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      aiBuilt: data.get("aiBuilt") === "on",
      image,
    }));
    setVideo(String(data.get("videoUrl") ?? "").trim());
  }

  return (
    <ActionForm action={action}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" onInput={onInput} onChange={onInput}>
        <div className="space-y-6">
          <section className="space-y-4">
            <h2 className="text-sm font-semibold">About the project</h2>
            <Field label="Project name">
              <input name="title" required minLength={2} maxLength={120} defaultValue={defaults.title} className={inputClass} />
            </Field>
            <Field label="What it does (one sentence)">
              <input name="pitch" required minLength={10} maxLength={200} defaultValue={defaults.pitch} placeholder="Helps market women in Kumasi track MoMo sales." className={inputClass} />
            </Field>
            <Field label="Who it is for (optional)">
              <input name="audience" maxLength={200} defaultValue={defaults.audience ?? ""} className={inputClass} />
            </Field>
            <Field label="Built with" hint="Tools, AI and stack, separated by commas: e.g. Lovable, Supabase, Paystack.">
              <input name="builtWith" maxLength={600} defaultValue={defaults.builtWith.join(", ")} className={inputClass} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="aiBuilt" defaultChecked={defaults.aiBuilt} className="mt-1" />
              <span>AI tools wrote most of it (be honest; nobody is looked down on for how they build)</span>
            </label>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold">Links</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Live demo (optional)">
                <input name="liveUrl" defaultValue={defaults.liveUrl ?? ""} placeholder="https://" className={inputClass} />
              </Field>
              <Field label="Repository (optional)">
                <input name="repoUrl" defaultValue={defaults.repoUrl ?? ""} placeholder="https://github.com/…" className={inputClass} />
              </Field>
            </div>
            <Field label="Video demo (optional)" hint="1 to 3 minutes of screen recording on Loom, YouTube or Google Drive (shared so anyone with the link can view).">
              <input name="videoUrl" defaultValue={defaults.videoUrl ?? ""} placeholder="https://www.loom.com/share/…" className={inputClass} />
            </Field>
            {withScreenshot && (
              <Field label="Screenshot (optional)" hint="PNG, JPG, WebP or GIF. Pictures are made smaller before upload. You can add up to four on the project page.">
                <ImageInput name="screenshot" />
              </Field>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold">Feedback</h2>
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 font-medium">What should reviewers look at?</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {Object.entries(FEEDBACK_AREAS).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input type="checkbox" name="feedbackAreas" value={value} defaultChecked={defaults.feedbackAreas.includes(value)} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="What I want feedback on (optional)">
              <textarea name="feedbackWanted" rows={3} maxLength={1000} defaultValue={defaults.feedbackWanted ?? ""} className={inputClass} />
            </Field>
            <Field label="What I am stuck on (optional)">
              <textarea name="stuckOn" rows={2} maxLength={1000} defaultValue={defaults.stuckOn ?? ""} className={inputClass} />
            </Field>
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 font-medium">What I need</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {Object.entries(NEEDS).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input type="checkbox" name="needs" value={value} defaultChecked={defaults.needs.includes(value)} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Who can see it">
              <select name="visibility" defaultValue={defaults.visibility} className={inputClass}>
                <option value="PUBLIC">Everyone (shows in the public showcase)</option>
                <option value="MEMBERS">Signed-in members only</option>
              </select>
            </Field>
          </section>

          <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30">
            <h2 className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="size-4" aria-hidden /> Safety check before you post
            </h2>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="noSecrets" required className="mt-1" />
              <span>No API keys, passwords or secrets in my links, repository or screenshots.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="loginProtected" required className="mt-1" />
              <span>Private pages of my app need a login.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="noPersonalData" required className="mt-1" />
              <span>No real people&apos;s personal data is shown (use test data).</span>
            </label>
          </section>

          <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
        </div>

        <aside className="space-y-2 lg:sticky lg:top-6 lg:self-start">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Preview</p>
          <PostCardView post={preview} />
          {video && <p className="text-xs text-muted">Video demo: {videoHost(/^https?:\/\//.test(video) ? video : `https://${video}`)}</p>}
        </aside>
      </div>
    </ActionForm>
  );
}
