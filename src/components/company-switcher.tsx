"use client";

import { useRef } from "react";

/** Phase 22: switches the company a person works in (for people in several companies). */
export function CompanySwitcher({
  companies,
  current,
  action,
}: {
  companies: { id: string; name: string }[];
  current: string;
  action: (form: FormData) => Promise<void>;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action} className="px-2">
      <label className="sr-only" htmlFor="company-switcher">
        Company
      </label>
      <select
        id="company-switcher"
        name="companyId"
        defaultValue={current}
        onChange={() => form.current?.requestSubmit()}
        className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg shadow-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="mt-2 text-xs underline">
          Switch
        </button>
      </noscript>
    </form>
  );
}
