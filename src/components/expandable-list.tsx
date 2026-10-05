"use client";

import { useState } from "react";

/** A list that shows its first `initial` items and a "Show N more" button for the rest. */
export function ExpandableList({
  items,
  initial,
  as: Tag = "ul",
  className,
}: {
  items: React.ReactNode[];
  initial: number;
  as?: "ul" | "ol";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const hidden = items.length - initial;
  return (
    <>
      <Tag className={className}>{open || hidden <= 0 ? items : items.slice(0, initial)}</Tag>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-3 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
        >
          {open ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
    </>
  );
}
