import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage() {
  if (await getSignedIn()) redirect("/community");
  const signIn = (
    <p>
      Already have an account?{" "}
      <Link href="/sign-in" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
        Sign in
      </Link>
    </p>
  );
  if (!signupOpen()) {
    return (
      <AuthShell title="Sign-up is closed" description="New members can't join here right now. If your company already uses the app, ask one of its Admins to invite you." footer={signIn}>
        {null}
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Join the community" description="Free for everyone who builds software in Ghana, whether you code by hand or with AI tools." footer={signIn}>
      <SignUpForm />
    </AuthShell>
  );
}
