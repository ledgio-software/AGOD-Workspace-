import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  // Optional on Vercel: derived from Vercel's system variables when not set.
  BETTER_AUTH_URL: z.url().optional(),
  APP_TIMEZONE: z.string().default("Africa/Accra"),
});

export type Env = z.infer<typeof envSchema> & { baseUrl: string };

type Source = Record<string, string | undefined>;

/**
 * Public base URL of the app. Explicit BETTER_AUTH_URL wins; on Vercel, production uses the
 * production domain and previews use their branch URL (stable per branch, e.g. `integration`).
 */
export function resolveBaseUrl(source: Source): string | undefined {
  if (source.BETTER_AUTH_URL) return source.BETTER_AUTH_URL;
  if (source.VERCEL_ENV === "production" && source.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${source.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (source.VERCEL_BRANCH_URL) return `https://${source.VERCEL_BRANCH_URL}`;
  if (source.VERCEL_URL) return `https://${source.VERCEL_URL}`;
  return undefined;
}

export function parseEnv(source: Source): Env {
  const result = envSchema.safeParse(source);
  const baseUrl = resolveBaseUrl(source);
  const issues = result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  if (!baseUrl) issues.push("BETTER_AUTH_URL: required outside Vercel");
  if (!result.success || !baseUrl) {
    throw new Error(`Invalid environment configuration: ${issues.join("; ")}`);
  }
  return { ...result.data, baseUrl };
}
