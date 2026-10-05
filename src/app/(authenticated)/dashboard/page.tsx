import Link from "next/link";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="text-sm text-zinc-500">
        Signed in as {user.email}. Totals and reports arrive with the payout ledger (phases 3 and 4).
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>
          <Link href="/my-work" className="underline">
            My work
          </Link>
          : your tasks, progress and payouts.
        </li>
        <li>
          <Link href="/projects" className="underline">
            Projects
          </Link>
          {can(user, "project.create") ? ": create projects, set up teams, splits and tasks." : ": the projects you are part of."}
        </li>
      </ul>
    </div>
  );
}
