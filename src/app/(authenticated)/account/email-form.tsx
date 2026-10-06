"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { setDailyEmailAction } from "./actions";

export function DailyEmailForm({ on }: { on: boolean }) {
  return (
    <ActionForm action={setDailyEmailAction} className="flex flex-wrap items-center justify-between gap-3">
      <input type="hidden" name="dailyEmail" value={String(!on)} />
      <p className="text-sm">
        Daily email is <strong>{on ? "on" : "off"}</strong>.
      </p>
      <SubmitButton size="sm" variant="secondary">
        {on ? "Turn off" : "Turn on"}
      </SubmitButton>
    </ActionForm>
  );
}
