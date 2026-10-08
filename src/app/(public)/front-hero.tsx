import { LiteVideo } from "@/components/lite-video";
import { cx } from "@/components/ui";
import type { FrontPage } from "@/modules/community/front";
import { PhotoSlideshow } from "./photo-slideshow";

/**
 * Phase 35: the welcome banner: the organizers' photos behind the text (a brand colour wash when
 * there are none) and the welcome video beside it (below it on a phone).
 */
export function FrontHero({ front, children }: { front: FrontPage; children: React.ReactNode }) {
  const hasPhotos = front.photos.length > 0;
  return (
    <section className="relative isolate overflow-hidden rounded-2xl text-white shadow-sm">
      {hasPhotos ? <PhotoSlideshow photos={front.photos} /> : <div className="absolute inset-0 bg-gradient-to-br from-brand-800 via-brand-600 to-amber-500" aria-hidden />}
      {/* Darker on the text side so it stays readable on any photo. */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/55 to-black/30" aria-hidden />
      <div className={cx("relative grid items-center gap-8 px-5 py-10 sm:px-10 sm:py-14", front.video && "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}>
        <div className="space-y-5 [text-shadow:0_1px_2px_rgb(0_0_0/0.4)]">{children}</div>
        {front.video && <LiteVideo embed={front.video.embed} title={front.video.title ?? "Welcome to the community"} />}
      </div>
    </section>
  );
}
