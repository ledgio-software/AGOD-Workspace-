import { roleLabel } from "@/lib/labels";
import { requireUser } from "@/lib/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="text-sm text-zinc-500">
          {user.name} · {user.email} · {roleLabel[user.role]}
        </p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
