// Timestamps are stored in UTC and rendered in AGOD's operating timezone (decision 6).
const timeZone = process.env.APP_TIMEZONE ?? "Africa/Accra";

export function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone }).format(value);
}

export function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(value);
}
