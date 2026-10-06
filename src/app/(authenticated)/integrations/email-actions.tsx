"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { runDailyNowAction, sendTestEmailAction } from "./actions";

export function EmailActions({ canSend }: { canSend: boolean }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      {canSend && (
        <ActionForm action={sendTestEmailAction}>
          <SubmitButton size="sm" variant="secondary" pendingText="Sending…">
            Send me a test email
          </SubmitButton>
        </ActionForm>
      )}
      <ActionForm action={runDailyNowAction} confirmMessage="Run the daily reminders now? Everyone with new notifications gets their email today instead of tomorrow morning.">
        <SubmitButton size="sm" variant="secondary" pendingText="Running…">
          Run daily reminders now
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
