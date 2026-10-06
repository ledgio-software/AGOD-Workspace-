"use client";

import { useRef, useState } from "react";
import { compressImage, formatSize } from "@/lib/image-compress";

/**
 * A file input for pictures that makes them smaller before upload (Phase 26.1). The form can't be
 * sent while a picture is being prepared. Fires a bubbling "change" once the smaller file is in
 * place, so live previews can use it.
 */
export function ImageInput({ name, required = false }: { name: string; required?: boolean }) {
  const [note, setNote] = useState<string | null>(null);
  const replacing = useRef(false);

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (replacing.current) {
      replacing.current = false;
      return;
    }
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      setNote(null);
      return;
    }
    input.setCustomValidity("Wait a moment: the picture is being prepared.");
    setNote("Preparing the picture…");
    const smaller = await compressImage(file);
    if (smaller !== file && typeof DataTransfer !== "undefined") {
      const list = new DataTransfer();
      list.items.add(smaller);
      input.files = list.files;
      replacing.current = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      setNote(`Made smaller for upload: ${formatSize(file.size)} → ${formatSize(smaller.size)}.`);
    } else {
      setNote(null);
    }
    input.setCustomValidity("");
  }

  return (
    <>
      <input name={name} type="file" required={required} accept="image/png,image/jpeg,image/webp,image/gif" onChange={onChange} className="block w-full text-sm" />
      {note && (
        <span role="status" className="block text-xs text-emerald-700 dark:text-emerald-400">
          {note}
        </span>
      )}
    </>
  );
}
