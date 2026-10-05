import { describe, expect, it } from "vitest";
import { formatMoney, formatPercent, minorToInput, parseMoney, parsePercent } from ".";

describe("parseMoney", () => {
  it.each([
    ["1250", 125_000],
    ["1,250.5", 125_050],
    ["1250.50", 125_050],
    ["0.01", 1],
    ["0", 0],
    ["  42.10 ", 4_210],
  ])("%s -> %d pesewas", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(["", "-5", "1.234", "abc", "1e3", "12.3.4", "GHS 5"])("rejects %j", (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it("avoids floating point errors (0.1 + 0.2 style inputs)", () => {
    expect(parseMoney("0.29")).toBe(29);
    expect(parseMoney("1.15")).toBe(115);
  });
});

describe("formatMoney", () => {
  it("formats with currency and thousands separators", () => {
    expect(formatMoney(125_050)).toBe("GHS 1,250.50");
    expect(formatMoney(5)).toBe("GHS 0.05");
    expect(formatMoney(0)).toBe("GHS 0.00");
    expect(formatMoney(-150)).toBe("-GHS 1.50");
  });

  it("round-trips through the input format", () => {
    expect(parseMoney(minorToInput(123_456))).toBe(123_456);
  });
});

describe("percentages", () => {
  it("parses into basis points", () => {
    expect(parsePercent("33.33")).toBe(3_333);
    expect(parsePercent("100")).toBe(10_000);
    expect(parsePercent("0.5")).toBe(50);
  });

  it("rejects out-of-range and over-precise values", () => {
    expect(parsePercent("100.01")).toBeNull();
    expect(parsePercent("12.345")).toBeNull();
    expect(parsePercent("-1")).toBeNull();
  });

  it("formats", () => {
    expect(formatPercent(3_333)).toBe("33.33%");
    expect(formatPercent(5_000)).toBe("50%");
  });
});
