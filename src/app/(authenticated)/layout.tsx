import { requireUser } from "@/lib/session";
import { SignOutButton } from "@/components/sign-out-button";

const roleLabel = {
  TEAM_MEMBER: "Team Member",
  PROJECT_MANAGER: "Project Manager",
  ADMIN: "Admin",
} as const;

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <span className="font-semibold">AGOD Payout Tracker</span>
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
