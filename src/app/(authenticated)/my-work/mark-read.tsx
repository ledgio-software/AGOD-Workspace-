"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { markNotificationsReadAction } from "./actions";

export function MarkReadButton() {
  return (
    <ActionForm action={markNotificationsReadAction}>
      <SubmitButton variant="secondary">Mark all as read</SubmitButton>
    </ActionForm>
  );
}
