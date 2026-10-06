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

/** "2026-10-08" + "14:30" in the operating time zone (or another) → the instant. */
export function zonedTime(date: string, time: string, zone = timeZone): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const asZone = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(guess.getTime() - (asZone - guess.getTime()));
}
