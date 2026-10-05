import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">AGOD Payout Tracker</h1>
          <p className="text-sm text-zinc-500">Sign in with your AGOD account.</p>
        </div>
        <SignInForm />
      </div>
    </main>
  );
}
