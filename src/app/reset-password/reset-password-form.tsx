"use client";

import Link from "next/link";
import { useState } from "react";
import { FormNotice } from "@/components/auth-shell";
import { inputClass } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) {
      setError("The two passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (error) {
      setError(
        error.code === "PASSWORD_TOO_SHORT"
          ? "Use a password of at least 10 characters."
          : error.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : "This link has expired or was already used. Ask for a new one.",
      );
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <FormNotice tone="good">Your password is set.</FormNotice>
        <Link href="/sign-in" className={`${buttonClass("primary")} w-full`}>
          Sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-fg">New password</span>
        <input name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
        <span className="block text-xs text-muted">At least 10 characters.</span>
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-fg">Confirm password</span>
        <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </label>
      {error && <FormNotice tone="bad">{error}</FormNotice>}
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} w-full`}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
