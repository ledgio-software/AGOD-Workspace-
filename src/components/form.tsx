"use client";

import { useFormStatus } from "react-dom";

export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";

export function SubmitButton({ children, pendingText }: { children: React.ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
    >
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

export function FormMessage({ state }: { state: { ok: boolean; error?: string; message?: string } | null }) {
  if (!state) return null;
  if (!state.ok) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {state.error}
      </p>
    );
  }
  return state.message ? <p className="text-sm text-green-700 dark:text-green-500">{state.message}</p> : null;
}

/** Shows a one-time password once. It is never stored in readable form. */
export function TemporaryPassword({ email, password }: { email: string; password: string }) {
  return (
    <div className="space-y-1 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <p>
        Temporary password for <strong>{email}</strong>. Share it privately; it is shown only once. The member
        should change it on the Account page after signing in.
      </p>
      <code className="block select-all rounded bg-white px-2 py-1 font-mono dark:bg-black">{password}</code>
    </div>
  );
}
