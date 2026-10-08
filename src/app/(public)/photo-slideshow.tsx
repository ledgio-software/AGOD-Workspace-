"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";

/** Phase 35: the front page photos, fading from one to the next every few seconds (still for people who prefer less motion). */
export function PhotoSlideshow({ photos, seconds = 6 }: { photos: { id: string; alt: string }[]; seconds?: number }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (photos.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % photos.length), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [photos.length, seconds]);
  return (
    <div className="absolute inset-0" aria-roledescription="slideshow">
      {photos.map((p, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={p.id}
          src={`/front/photos/${p.id}`}
          alt={i === index ? p.alt : ""}
          aria-hidden={i !== index}
          loading={i === 0 ? "eager" : "lazy"}
          className={cx("absolute inset-0 size-full object-cover transition-opacity duration-1000", i === index ? "opacity-100" : "opacity-0")}
        />
      ))}
    </div>
  );
}
