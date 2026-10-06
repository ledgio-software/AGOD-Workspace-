import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getCurrentUser, getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  if (await getSignedIn()) redirect("/community");
  const canSignUp = signupOpen();

  return (
    <AuthShell
      title="Sign in"
      description="Welcome back to the community and your workspace."
      footer={
        <>
          <p>
            <Link href="/forgot-password" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              Forgot your password?
            </Link>
          </p>
          <p>
            {canSignUp ? (
              <>
                New here?{" "}
                <Link href="/sign-up" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                  Join the community
                </Link>
              </>
            ) : (
              "No account yet? Ask an Admin of your company to invite you."
            )}
          </p>
        </>
      }
    >
      <SignInForm />
    </AuthShell>
  );
}
