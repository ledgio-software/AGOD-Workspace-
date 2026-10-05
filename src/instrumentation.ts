import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring";
import { parseEnv } from "@/lib/env";

export function register() {
  // Fail fast on server start if required configuration is missing.
  parseEnv(process.env);

  // Error monitoring is optional: active only when SENTRY_DSN is configured.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    Sentry.init({
      ...sentryOptions,
      dsn: process.env.SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
