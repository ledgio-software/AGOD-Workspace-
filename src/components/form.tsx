"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";

export const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg shadow-xs placeholder:text-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50";

type State = { ok: boolean; error?: string; message?: string } | null;

const PendingContext = createContext<boolean | null>(null);

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const formStatus = useFormStatus();
  const contextPending = useContext(PendingContext);
  const pending = contextPending ?? formStatus.pending;
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant)}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

export function FormMessage({ state }: { state: State }) {
  if (!state) return null;
  if (!state.ok) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {state.error}
      </p>
    );
  }
  return state.message ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p> : null;
}

/**
 * Form bound to a server action. Unlike a plain `<form action>`, it keeps what the user typed when
 * the action fails (React resets forms after every action), and resets only on success if asked.
 */
export function ActionForm<S extends State>({
  action,
  children,
  className,
  resetOnSuccess = false,
  confirmMessage,
  renderResult,
}: {
  action: (prev: S | null, form: FormData) => Promise<S>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirmMessage?: string;
  /** Extra output shown under the message once the action has returned. */
  renderResult?: (state: S) => React.ReactNode;
}) {
  const [state, dispatch, actionPending] = useActionState(action, null);
  const [transitionPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <PendingContext.Provider value={actionPending || transitionPending}>
      <form
        ref={formRef}
        className={className}
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmMessage && !confirm(confirmMessage)) return;
          const data = new FormData(event.currentTarget);
          startTransition(() => dispatch(data));
        }}
      >
        {children}
        <FormMessage state={state} />
        {state && renderResult?.(state)}
      </form>
    </PendingContext.Provider>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="block whitespace-pre-line text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Shows a one-time password once. It is never stored in readable form. */
export function TemporaryPassword({ email, password }: { email: string; password: string }) {
  return (
    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <p>
        Temporary password for <strong>{email}</strong>. Share it privately; it is shown only once. The member
        should change it on the Account page after signing in.
      </p>
      <code className="block select-all rounded-lg bg-white px-3 py-2 font-mono dark:bg-black">{password}</code>
    </div>
  );
}
