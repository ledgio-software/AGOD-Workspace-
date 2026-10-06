import Link from "next/link";
import { connection } from "next/server";
import { AuthShell } from "@/components/auth-shell";
import { emailConfig } from "@/lib/email";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage() {
  // Email settings are read per request (they differ per environment), not at build time.
  await connection();
  const back = (
    <p>
      <Link href="/sign-in" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
        Back to sign in
      </Link>
    </p>
  );
  if (!emailConfig()) {
    return (
      <AuthShell title="Forgot your password?" description="Email isn't set up here yet, so ask an Admin of your company to reset your password from the Team page." footer={back}>
        {null}
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Forgot your password?" description="Enter your email and we'll send you a link to choose a new one." footer={back}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
