import { describe, expect, it } from "vitest";
import { weekStartOf } from "./weekly";

describe("weekStartOf", () => {
  it("returns the Monday of the week", () => {
    expect(weekStartOf("2026-10-05")).toBe("2026-10-05"); // Monday
    expect(weekStartOf("2026-10-11")).toBe("2026-10-05"); // Sunday
    expect(weekStartOf("2026-10-01")).toBe("2026-09-28"); // Thursday, across a month
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28"); // across a year
  });
});
