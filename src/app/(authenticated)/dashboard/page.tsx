import { requireUser } from "@/lib/session";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="text-sm text-zinc-500">
        Signed in as {user.email}. Projects, ledger and reporting arrive in later phases.
      </p>
    </div>
  );
}
