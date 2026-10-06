"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { disconnectGoogleAction, syncDriveAction } from "./actions";

export function GoogleActions() {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <ActionForm action={syncDriveAction}>
        <SubmitButton size="sm" variant="secondary" pendingText="Syncing…">
          Sync folders and sharing now
        </SubmitButton>
      </ActionForm>
      <ActionForm
        action={disconnectGoogleAction}
        confirmMessage="Disconnect Google? New uploads go to the app's own storage again, and files already saved in Drive can't be opened from the app until the same account is connected again. Nothing is deleted from Drive."
      >
        <SubmitButton size="sm" variant="danger" pendingText="Disconnecting…">
          Disconnect
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
