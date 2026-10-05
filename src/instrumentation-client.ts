import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    ...sentryOptions,
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });
}
