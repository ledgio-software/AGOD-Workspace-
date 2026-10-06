import { redirect } from "next/navigation";
import { Building } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentUser, getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { CreateCompanyForm } from "./create-company-form";

// Phase 22: signed in, but not an active member of any company (removed from their only one, or
// not added yet).
export default async function NoCompanyPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  const user = await getSignedIn();
  if (!user) redirect("/sign-in");
  return (
    <main className="grid min-h-dvh flex-1 place-items-center bg-canvas px-4">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <Building className="mx-auto size-10 text-muted" aria-hidden />
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">You&apos;re not in a company yet</h1>
          <p className="text-sm text-muted">
            You are signed in as <span className="font-medium text-fg">{user.email}</span>, but no company has added you, or your access was
            removed. Ask an Admin of your company to add you on their Team page, then sign in again.
          </p>
        </div>
        {signupOpen() && (
          <div className="space-y-3 border-t border-line pt-5">
            <p className="text-sm font-medium">Or start your own company</p>
            <CreateCompanyForm />
          </div>
        )}
        <div className="flex items-center justify-center gap-1 text-sm text-muted">
          Sign out <SignOutButton />
        </div>
      </div>
    </main>
  );
}
