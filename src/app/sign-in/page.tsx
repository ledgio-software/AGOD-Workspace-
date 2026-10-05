import { redirect } from "next/navigation";
import { BadgeCheck, ShieldCheck, Wallet } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { SignInForm } from "./sign-in-form";

const points = [
  { icon: BadgeCheck, title: "Every amount explained", text: "Approved splits are frozen, and every change has a reason." },
  { icon: Wallet, title: "Payouts you can trust", text: "See what is owed, paid and outstanding, per person and project." },
  { icon: ShieldCheck, title: "Private by design", text: "Each person sees only what their role allows." },
];

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="grid min-h-dvh flex-1 lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-brand-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_10%,rgba(99,102,241,0.45),transparent),radial-gradient(50%_40%_at_90%_90%,rgba(129,140,248,0.25),transparent)]"
        />
        <div className="relative flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-white/10 text-sm font-bold ring-1 ring-white/20">A</span>
          <span className="font-semibold">AGOD Projects &amp; Payouts</span>
        </div>
        <div className="relative max-w-md space-y-8">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Track the work. Know who is owed. Pay with confidence.
          </h2>
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
        <p className="relative text-xs text-brand-300">AGOD Software Solutions · internal workspace</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-600 font-bold text-white shadow-sm lg:hidden">A</span>
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-sm text-muted">Use the AGOD account an Admin created for you.</p>
          </div>
          <SignInForm />
          <p className="text-xs text-muted">No account or forgot your password? Ask an Admin to set it up or reset it.</p>
        </div>
      </section>
    </main>
  );
}
