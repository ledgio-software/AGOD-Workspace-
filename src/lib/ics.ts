// Phase 27: an iCalendar (.ics) event, so a session can be added to Google Calendar, Outlook or
// Apple Calendar (attached to the confirmation email, and downloadable from the session page).
// Pure: unit-tested in ics.test.ts.

export type IcsEvent = {
  uid: string;
  title: string;
  description: string;
  start: Date;
  end: Date;
  url?: string;
  location?: string;
  cancelled?: boolean;
  /** When this version was made (DTSTAMP); defaults to now. */
  stamp?: Date;
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Escapes text values (RFC 5545 §3.3.11). */
export const escapeIcs = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds lines longer than 75 octets (RFC 5545 §3.1), without splitting a character. */
export function foldIcs(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (encoder.encode(current + char).length > limit) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function icsEvent(e: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ghana Vibe Coders & Developers//Sessions//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(e.stamp ?? new Date())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${escapeIcs(e.title)}`,
    `DESCRIPTION:${escapeIcs(e.description)}`,
    ...(e.url ? [`URL:${e.url}`] : []),
    ...(e.location ? [`LOCATION:${escapeIcs(e.location)}`] : []),
    `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcs).join("\r\n") + "\r\n";
}
