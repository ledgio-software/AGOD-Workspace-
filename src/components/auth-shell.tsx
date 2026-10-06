import { BadgeCheck, ShieldCheck, Wallet } from "lucide-react";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";

// Phase 23: the frame of the public pages (sign in, sign up, password reset): the product on the
// left (large screens), the form on the right.

const points = [
  { icon: BadgeCheck, title: "Every amount explained", text: "Approved splits are frozen, and every change has a reason." },
  { icon: Wallet, title: "Payouts you can trust", text: "See what is owed, paid and outstanding, per person and project." },
  { icon: ShieldCheck, title: "Private by design", text: "Each company sees only its own data, and each person only what their role allows." },
];

const initials = PRODUCT_NAME.split(/\s+/)
  .filter((w) => /^[A-Za-z]/.test(w))
  .slice(0, 2)
  .map((w) => w[0])
  .join("");

export function AuthShell({ title, description, children, footer }: { title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh flex-1 lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-brand-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_10%,rgba(99,102,241,0.45),transparent),radial-gradient(50%_40%_at_90%_90%,rgba(129,140,248,0.25),transparent)]"
        />
        <div className="relative flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-white/10 text-sm font-bold ring-1 ring-white/20">{initials}</span>
          <span className="leading-tight">
            <span className="block font-semibold">{PRODUCT_NAME}</span>
            <span className="block text-xs text-brand-300">{PRODUCT_TAGLINE}</span>
          </span>
        </div>
        <div className="relative max-w-md space-y-8">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Track the work. Know who is owed. Pay with confidence.</h2>
          <ul className="space-y-5">
            {points.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-brand-300" aria-hidden />
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-brand-200">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-300">Projects, tasks, invoices and team payouts for software teams.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 lg:hidden">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white shadow-sm">{initials}</span>
              <span className="text-sm font-semibold leading-tight">{PRODUCT_NAME}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted">{description}</p>}
          </div>
          {children}
          {footer && <div className="space-y-2 text-sm text-muted">{footer}</div>}
        </div>
      </section>
    </main>
  );
}

/** Error / success boxes used by the public forms. */
export function FormNotice({ tone, children }: { tone: "bad" | "good"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "bad" ? "alert" : "status"}
      className={
        tone === "bad"
          ? "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          : "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
      }
    >
      {children}
    </p>
  );
}
