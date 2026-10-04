import "server-only";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { PermissionError } from "@/lib/permissions";
import { ServiceError } from "@/modules/errors";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string };

/**
 * Runs a server action body and turns expected failures into messages for the form.
 * Unexpected errors are reported to monitoring and shown as a generic message.
 */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (error) {
    if (error instanceof PermissionError) {
      return { ok: false, error: "You don't have permission to do that." };
    }
    if (error instanceof ServiceError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(" ") };
    }
    Sentry.captureException(error);
    console.error(error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
