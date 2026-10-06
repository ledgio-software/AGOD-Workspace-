import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

// The link in a password-reset or invitation email lands here (via /api/auth/reset-password/<token>).
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string; welcome?: string }> }) {
  const { token, error, welcome } = await searchParams;
  const footer = (
    <p>
      <Link href="/sign-in" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
        Back to sign in
      </Link>
    </p>
  );
  if (!token || error) {
    return (
      <AuthShell
        title="This link has expired"
        description={
          <>
            Links to choose a password work once, for a limited time.{" "}
            <Link href="/forgot-password" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              Ask for a new one
            </Link>
            {welcome ? ", or ask the person who invited you to send the invitation again." : "."}
          </>
        }
        footer={footer}
      >
        {null}
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title={welcome ? "Welcome! Choose your password" : "Choose a new password"}
      description={welcome ? "You're one step away from your team's workspace." : "You'll be signed out everywhere else."}
      footer={footer}
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
