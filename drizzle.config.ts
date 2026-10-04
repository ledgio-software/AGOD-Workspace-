import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { normalizeDatabaseUrl } from "./src/lib/db/url";

config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "./src/lib/db/schema",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: normalizeDatabaseUrl(process.env.DATABASE_URL!) },
  // Timestamped, descriptive migration files, e.g. 20261004120000_create_users.sql
  migrations: { prefix: "timestamp" },
  strict: true,
  verbose: true,
});
