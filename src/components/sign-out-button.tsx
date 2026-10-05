"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      title="Sign out"
      className="inline-flex items-center rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-fg"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
    >
      <LogOut className="size-4" aria-hidden />
      <span className="sr-only">Sign out</span>
    </button>
  );
}
