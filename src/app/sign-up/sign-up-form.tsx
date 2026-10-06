"use client";

import { useState } from "react";
import { FormNotice } from "@/components/auth-shell";
import { inputClass } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function SignUpForm() {
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [withCompany, setWithCompany] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError("The two passwords don't match.");
      return;
    }
    if (form.get("conduct") !== "on") {
      setError("Please agree to the code of conduct.");
      return;
    }
    const company = withCompany ? String(form.get("company") ?? "").trim() : "";
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")).trim(),
      email,
      password,
      // Phase 25: optional. Created as your company workspace once you confirm your email.
      ...(company ? { pendingCompany: company } : {}),
      callbackURL: company ? "/dashboard" : "/community",
    } as Parameters<typeof authClient.signUp.email>[0]);
    setPending(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many sign-ups from here. Try again in an hour."
          : error.code === "PASSWORD_TOO_SHORT"
            ? "Use a password of at least 10 characters."
            : (error.message ?? "Sign-up didn't work. Check the details and try again."),
      );
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="space-y-3">
        <FormNotice tone="good">
          Almost done. We sent a link to <strong>{sentTo}</strong>. Open it to confirm your email and you&apos;re signed in
          {withCompany ? " with your company workspace ready" : ""}.
        </FormNotice>
        <p className="text-sm text-muted">No email after a few minutes? Check your spam folder, or sign in to get a new link.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-fg">Your name</span>
        <input name="name" required minLength={2} maxLength={120} autoComplete="name" className={inputClass} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-fg">Email</span>
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-fg">Password</span>
        <input name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
        <span className="block text-xs text-muted">At least 10 characters.</span>
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-fg">Confirm password</span>
        <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </label>
      <div className="space-y-2 rounded-lg border border-line p-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={withCompany} onChange={(e) => setWithCompany(e.target.checked)} className="mt-1" />
          <span>
            <span className="font-medium">Also create a company workspace</span>
            <span className="block text-xs text-muted">To track projects, invoices and team payouts. You can also do this later.</span>
          </span>
        </label>
        {withCompany && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-fg">Company or team name</span>
            <input name="company" required minLength={2} maxLength={120} autoComplete="organization" className={inputClass} />
          </label>
        )}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="conduct" required className="mt-1" />
        <span>
          I agree to the{" "}
          <a href="/code-of-conduct" target="_blank" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            code of conduct
          </a>
          .
        </span>
      </label>
      {error && <FormNotice tone="bad">{error}</FormNotice>}
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} w-full`}>
        {pending ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
