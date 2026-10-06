"use client";

import { useState } from "react";
import { FormNotice } from "@/components/auth-shell";
import { inputClass } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({ email: String(form.get("email")).trim(), redirectTo: "/reset-password" });
    setPending(false);
    if (error) {
      setError(error.status === 429 ? "Too many requests. Try again in an hour." : "That didn't work. Check the email address and try again.");
      return;
    }
    // Same answer whether or not the address has an account.
    setSent(true);
  }

  if (sent) {
    return <FormNotice tone="good">If that email has an account, a link to choose a new password is on its way. It works for 1 hour.</FormNotice>;
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-fg">Email</span>
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </label>
      {error && <FormNotice tone="bad">{error}</FormNotice>}
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} w-full`}>
        {pending ? "Sending…" : "Send me a link"}
      </button>
    </form>
  );
}
