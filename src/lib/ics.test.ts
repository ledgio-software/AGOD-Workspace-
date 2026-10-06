import { describe, expect, it } from "vitest";
import { escapeIcs, foldIcs, icsEvent } from "./ics";

describe("calendar files (Phase 27)", () => {
  const event = {
    uid: "abc@gvcd",
    title: "Build your first app with AI; live",
    description: "Bring a laptop, a Lovable account\nand questions.",
    start: new Date("2026-10-10T14:00:00Z"),
    end: new Date("2026-10-10T15:30:00Z"),
    url: "https://gvcd.example/sessions/abc",
    location: "https://meet.google.com/abc-defg-hij",
    stamp: new Date("2026-10-06T09:00:00Z"),
  };

  it("writes a standard event in UTC with escaped text", () => {
    const ics = icsEvent(event);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261010T140000Z\r\n");
    expect(ics).toContain("DTEND:20261010T153000Z\r\n");
    expect(ics).toContain("DTSTAMP:20261006T090000Z\r\n");
    expect(ics).toContain("SUMMARY:Build your first app with AI\; live\r\n");
    expect(ics).toContain("DESCRIPTION:Bring a laptop\\, a Lovable account\\nand questions.\r\n");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("marks cancelled events", () => {
    const ics = icsEvent({ ...event, cancelled: true });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("folds long lines at 75 bytes without splitting characters", () => {
    const folded = foldIcs(`DESCRIPTION:${"Akwaaba ₵ ".repeat(20)}`);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(lines.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(`DESCRIPTION:${"Akwaaba ₵ ".repeat(20)}`);
    expect(escapeIcs("a\\b")).toBe("a\\\\b");
  });
});
