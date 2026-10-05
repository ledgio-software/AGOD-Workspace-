"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import { changeRole, createMember, resetPassword, setActive, setCapacity } from "@/modules/team";

type Credentials = { email: string; temporaryPassword: string };

export async function createMemberAction(
  _prev: ActionResult<Credentials> | null,
  form: FormData,
): Promise<ActionResult<Credentials>> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    const { member, temporaryPassword } = await createMember(
      actor,
      { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), role: form.get("role") as never },
      await getRequestMeta(),
    );
    return { email: member.email, temporaryPassword };
  });
  if (result.ok) revalidatePath("/team");
  return result;
}

export async function changeRoleAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await changeRole(
      actor,
      {
        userId: String(form.get("userId")),
        role: form.get("role") as never,
        reason: String(form.get("reason") ?? ""),
      },
      await getRequestMeta(),
    );
    return undefined;
  }, "Role updated.");
  if (result.ok) revalidatePath("/team");
  return result;
}

export async function setActiveAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const active = form.get("active") === "true";
  const result = await runAction(async () => {
    await setActive(
      actor,
      { userId: String(form.get("userId")), active, reason: String(form.get("reason") ?? "") },
      await getRequestMeta(),
    );
    return undefined;
  }, active ? "Member reactivated." : "Member deactivated and signed out.");
  if (result.ok) revalidatePath("/team");
  return result;
}

export async function resetPasswordAction(
  _prev: ActionResult<Credentials> | null,
  form: FormData,
): Promise<ActionResult<Credentials>> {
  const actor = await requireUser();
  return runAction(async () => {
    const { temporaryPassword } = await resetPassword(
      actor,
      { userId: String(form.get("userId")) },
      await getRequestMeta(),
    );
    return { email: String(form.get("email") ?? ""), temporaryPassword };
  });
}

export async function setCapacityAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await setCapacity(actor, { userId: String(form.get("userId")), hours: String(form.get("hours") ?? "") }, await getRequestMeta());
    return undefined;
  }, "Capacity updated.");
  if (result.ok) {
    revalidatePath("/team");
    revalidatePath("/workload");
  }
  return result;
}
