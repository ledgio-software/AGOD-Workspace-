/**
 * node-postgres currently treats `sslmode=require` as `verify-full` and warns that this will
 * change. Neon serves valid certificates, so make the strict mode explicit: same behaviour,
 * no warning, and no silent downgrade when pg changes its default.
 */
export function normalizeDatabaseUrl(url: string): string {
  if (!url) return url;
  const parsed = new URL(url);
  if (parsed.searchParams.get("sslmode") === "require" && !parsed.searchParams.has("uselibpqcompat")) {
    parsed.searchParams.set("sslmode", "verify-full");
  }
  return parsed.toString();
}
