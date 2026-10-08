import { LiteVideo } from "@/components/lite-video";
import { cx } from "@/components/ui";
import type { FrontPage } from "@/modules/community/front";
import { PhotoSlideshow } from "./photo-slideshow";

// A built-in first slide, so the banner always has a picture; organizers' photos follow it.
const BUILT_IN = [{ id: "coding", alt: "Code on a dark screen", src: "/front/coding.webp" }];

/**
 * Phase 35: the welcome banner: a slideshow behind the text (the built-in picture, then the
 * organizers' photos) and the welcome video beside it (below it on a phone).
 */
export function FrontHero({ front, children }: { front: FrontPage; children: React.ReactNode }) {
  const photos = [...BUILT_IN, ...front.photos.map((p) => ({ ...p, src: `/front/photos/${p.id}` }))];
  return (
    <section className="relative isolate overflow-hidden rounded-2xl bg-zinc-950 text-white shadow-sm">
      <PhotoSlideshow photos={photos} />
      {/* Darker on the text side so it stays readable on any photo. */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/55 to-black/30" aria-hidden />
      <div className={cx("relative grid items-center gap-8 px-5 py-10 sm:px-10 sm:py-14", front.video && "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}>
        <div className="space-y-5 [text-shadow:0_1px_2px_rgb(0_0_0/0.4)]">{children}</div>
        {front.video && <LiteVideo embed={front.video.embed} title={front.video.title ?? "Welcome to the community"} />}
      </div>
    </section>
  );
}
