import path from "node:path";
import { defineConfig } from "vitest/config";

// Vitest runs the unit tests for plain TypeScript code (ai/, integrations/, src/ helpers,
// dashboard server). Playwright specs live in tests/ and are NOT picked up here
// (JUnit for plain classes vs. Serenity for browser tests, in Java terms).
export default defineConfig({
  resolve: {
    alias: {
      "@src": path.resolve(import.meta.dirname, "src"),
      "@ai": path.resolve(import.meta.dirname, "ai"),
      "@integrations": path.resolve(import.meta.dirname, "integrations"),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "tests/**", "dashboard/dist/**"],
    environment: "node",
    restoreMocks: true,
  },
});
