"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

export function RemoveOrganizerButton({ action, handle, name }: { action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>; handle: string; name: string }) {
  return (
    <ActionForm action={action} confirmMessage={`Make ${name} a builder again?`}>
      <input type="hidden" name="handle" value={handle} />
      <SubmitButton size="sm" variant="secondary">
        Remove
      </SubmitButton>
    </ActionForm>
  );
}
