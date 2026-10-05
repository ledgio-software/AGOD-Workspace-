// Timestamps are stored in UTC and rendered in AGOD's operating timezone (decision 6).
const timeZone = process.env.APP_TIMEZONE ?? "Africa/Accra";

export function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone }).format(value);
}

export function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(value);
}

/** Today's date (YYYY-MM-DD) in the operating timezone; used for due/overdue checks. */
export function todayInOperatingZone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Formats a calendar date (YYYY-MM-DD) without timezone shifts. */
export function formatCalendarDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
