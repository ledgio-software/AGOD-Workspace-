// Money is integer minor units (pesewas) + ISO currency code. Never floats (design doc 2.4).

export const DEFAULT_CURRENCY = "GHS";
const MINOR_PER_MAJOR = 100;

/**
 * Parses user input like "1,250.5" or "1250.50" into minor units, using string arithmetic only.
 * Returns null for anything that is not a non-negative amount with at most 2 decimals.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number((match[2] ?? "").padEnd(2, "0"));
  const value = major * MINOR_PER_MAJOR + minor;
  return Number.isSafeInteger(value) ? value : null;
}

/** "GHS 1,250.50" */
export function formatMoney(amountMinor: number, currency: string = DEFAULT_CURRENCY): string {
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const major = Math.floor(abs / MINOR_PER_MAJOR).toLocaleString("en-US");
  const minor = String(abs % MINOR_PER_MAJOR).padStart(2, "0");
  return `${sign}${currency} ${major}.${minor}`;
}

/** Plain "1250.50", for pre-filling inputs. */
export function minorToInput(amountMinor: number): string {
  return `${Math.floor(amountMinor / MINOR_PER_MAJOR)}.${String(amountMinor % MINOR_PER_MAJOR).padStart(2, "0")}`;
}

// Percentages are basis points: 10000 = 100%, 1 = 0.01%.
export const FULL_BASIS_POINTS = 10_000;

/** Parses "33.33" (percent) into basis points; at most 2 decimals, 0–100. */
export function parsePercent(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return value <= FULL_BASIS_POINTS ? value : null;
}

/** 3333 -> "33.33%" */
export function formatPercent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2).replace(/\.00$/, "")}%`;
}
