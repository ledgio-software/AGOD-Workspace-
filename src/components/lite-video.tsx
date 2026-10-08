"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import type { VideoEmbed } from "@/modules/community/video";

/**
 * Phase 35: a video that loads only when someone taps play (saves data: nothing from YouTube,
 * Vimeo or Loom is downloaded before that).
 */
export function LiteVideo({ embed, title }: { embed: VideoEmbed; title: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-zinc-900 shadow-lg ring-1 ring-black/10">
      {playing ? (
        <iframe
          src={embed.embedUrl}
          title={title}
          className="absolute inset-0 size-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 size-full" aria-label={`Play video: ${title}`}>
          {embed.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={embed.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover opacity-90 transition group-hover:opacity-100" />
          ) : (
            <span className="absolute inset-0 bg-gradient-to-br from-brand-700 via-brand-600 to-amber-500" aria-hidden />
          )}
          <span className="absolute inset-0 bg-black/20" aria-hidden />
          <span className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-brand-700 shadow-lg transition group-hover:scale-105">
            <Play className="ml-1 size-7 fill-current" aria-hidden />
          </span>
          <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8 text-left text-sm font-medium text-white">
            {title} <span className="text-white/70">· {embed.provider}</span>
          </span>
        </button>
      )}
    </div>
  );
}
