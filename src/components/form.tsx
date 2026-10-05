"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useTransition } from "react";
import { useFormStatus } from "react-dom";

export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";

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
  const styles = {
    primary: "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
    secondary: "border border-zinc-300 dark:border-zinc-700",
    danger: "bg-red-700 text-white",
  }[variant];
  return (
    <button type="submit" disabled={pending} className={`rounded-md px-3 py-2 text-sm disabled:opacity-60 ${styles}`}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

export function FormMessage({ state }: { state: State }) {
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
}: {
  action: (prev: S | null, form: FormData) => Promise<S>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirmMessage?: string;
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
      </form>
    </PendingContext.Provider>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
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
