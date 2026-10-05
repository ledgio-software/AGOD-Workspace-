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
    env: { BETTER_AUTH_SECRET: "integration-test-secret-integration-test" },
  },
});
