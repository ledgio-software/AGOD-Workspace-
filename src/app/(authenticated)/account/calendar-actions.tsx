"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { disconnectMyCalendarAction, syncMyCalendarAction } from "./actions";

export function MyCalendarActions() {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <ActionForm action={syncMyCalendarAction}>
        <SubmitButton size="sm" variant="secondary" pendingText="Syncing…">
          Sync now
        </SubmitButton>
      </ActionForm>
      <ActionForm action={disconnectMyCalendarAction} confirmMessage="Disconnect your Google Calendar? The app stops updating it. The calendar stays in your Google account.">
        <SubmitButton size="sm" variant="danger" pendingText="Disconnecting…">
          Disconnect
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
