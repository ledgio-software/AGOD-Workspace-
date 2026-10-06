"use client";

import { useState } from "react";
import { inputClass } from "@/components/form";
import { buttonClass } from "@/components/ui";
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
    <form onSubmit={onSubmit} className="max-w-sm space-y-4">
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Current password</span>
        <input name="currentPassword" type="password" required autoComplete="current-password" className={inputClass} />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">New password (at least 10 characters)</span>
        <input name="newPassword" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Repeat new password</span>
        <input name="confirmPassword" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </label>
      {status && (
        <p role={status.ok ? undefined : "alert"} className={status.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-red-600 dark:text-red-400"}>
          {status.text}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("primary")}
      >
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
