import { Nav } from "@/components/nav";
import { SignOutButton } from "@/components/sign-out-button";
import { roleLabel } from "@/lib/labels";
import { requireUser } from "@/lib/session";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-6">
          <span className="font-semibold">AGOD Payout Tracker</span>
          <Nav actor={user} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span>
            {user.name} · {roleLabel[user.role]}
          </span>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
