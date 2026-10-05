import type * as Sentry from "@sentry/nextjs";

// Shared Sentry settings. The app handles passwords, session tokens and payout data, so the SDK
// collects only the error, stack trace and route: no request bodies, headers, cookies, query
// strings, user details, SQL parameters or local variable values.
export const sentryOptions: NonNullable<Parameters<typeof Sentry.init>[0]> = {
  sendClientReports: false,
  tracesSampleRate: 0,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    stackFrameVariables: false,
  },
};
