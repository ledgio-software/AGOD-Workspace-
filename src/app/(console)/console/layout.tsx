import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getSignedIn } from "@/lib/session";
import { asStaff } from "@/modules/platform";
import { ConsoleNav } from "./console-nav";

// Phase 40: the AGOD back office, for platform staff only (PLATFORM_ADMIN_EMAILS). Anyone else
// gets a plain "not found", so the console doesn't reveal that it exists.
// The title is only given to staff, so a "not found" page doesn't name the console either.
export async function generateMetadata(): Promise<Metadata> {
  const staff = await asStaff(await getSignedIn());
  return staff ? { title: { default: "Back office", template: "%s · Back office" }, robots: { index: false, follow: false } } : { robots: { index: false, follow: false } };
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await asStaff(await getSignedIn());
  if (!staff) notFound();
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-canvas">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/console" className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-5 text-amber-300" aria-hidden /> AGOD back office
          </Link>
          <ConsoleNav />
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-300">
            <span className="hidden sm:inline">{staff.name}</span>
            <Link href="/community" className="rounded-lg px-2 py-1 hover:bg-white/10 hover:text-white">
              Back to the app
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
