import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { AppealForm } from "./appeal-form";

// Phase 42: a blocked login asks AGOD staff for a second look (src/modules/safety/appeals.ts).

export const metadata: Metadata = { title: "Appeal a blocked login", robots: { index: false } };

export default function AppealPage() {
  return (
    <AuthShell
      title="Appeal a blocked login"
      description="If your login was blocked and you think it was a mistake, tell AGOD staff. They'll look again and email you their decision."
      footer={
        <p>
          <Link href="/sign-in" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Back to sign in
          </Link>
        </p>
      }
    >
      <AppealForm />
    </AuthShell>
  );
}
