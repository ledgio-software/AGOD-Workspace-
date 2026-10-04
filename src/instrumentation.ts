import { parseEnv } from "@/lib/env";

// Fail fast on server start if required configuration is missing.
export function register() {
  parseEnv(process.env);
}
