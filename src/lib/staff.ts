// Phase 40: AGOD back-office staff, who can open /console. Kept in configuration
// (PLATFORM_ADMIN_EMAILS on Vercel), so nobody can grant it to themselves from inside the app.

type Source = Record<string, string | undefined>;

export function platformAdminEmails(source: Source = process.env): Set<string> {
  return new Set(
    (source.PLATFORM_ADMIN_EMAILS ?? "")
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
}

export const isPlatformAdmin = (email: string | null | undefined, source: Source = process.env) => !!email && platformAdminEmails(source).has(email.trim().toLowerCase());
