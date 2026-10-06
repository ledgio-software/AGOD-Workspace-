import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs against a real, migrated PostgreSQL database (DATABASE_URL). Never point this at Neon
// staging or production: the tests create and modify data.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 20000,
    // PGOPTIONS: the owner connection defaults to the test company (tests/integration/fixtures.ts).
    env: { BETTER_AUTH_SECRET: "integration-test-secret-integration-test", PGOPTIONS: "-c app.org_id=00000000-0000-4000-8000-000000000001" },
  },
});
