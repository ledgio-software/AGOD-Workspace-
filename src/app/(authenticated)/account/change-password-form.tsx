"use client";

import { useState } from "react";
import { inputClass } from "@/components/form";
import { authClient } from "@/lib/auth-client";

export function ChangePasswordForm() {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = String(form.get("newPassword"));
    if (newPassword !== String(form.get("confirmPassword"))) {
      setStatus({ ok: false, text: "The new passwords don't match." });
      return;
    }
    setPending(true);
    const { error } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword")),
      newPassword,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) {
      setStatus({
        ok: false,
        text: error.message?.includes("short")
          ? "The new password must be at least 10 characters."
          : "Could not change the password. Check your current password.",
      });
      return;
    }
    formElement.reset();
    setStatus({ ok: true, text: "Password changed. Other devices have been signed out." });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">Change password</h2>
      <label className="block space-y-1 text-sm">
        <span>Current password</span>
        <input name="currentPassword" type="password" required autoComplete="current-password" className={inputClass} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>New password (at least 10 characters)</span>
        <input name="newPassword" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Repeat new password</span>
        <input name="confirmPassword" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </label>
      {status && (
        <p role={status.ok ? undefined : "alert"} className={status.ok ? "text-sm text-green-700" : "text-sm text-red-600"}>
          {status.text}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
