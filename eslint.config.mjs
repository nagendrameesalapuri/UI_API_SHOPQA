// ESLint flat config. typescript-eslint gives type-aware rules; the most important
// one for Playwright is no-floating-promises: a forgotten `await` on a page action is
// the #1 cause of flaky tests (the Java equivalent would be firing an action on another
// thread and never joining it).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import playwright from "eslint-plugin-playwright";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
      "reports/**",
      "dashboard/dist/**",
      "dashboard/.cache/**",
      ".github/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*.mjs", "scripts/*.mjs"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    ...playwright.configs["flat/recommended"],
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      "playwright/no-wait-for-timeout": "error",
      "playwright/no-force-option": "error",
      // Page objects own the assertions as verify*() methods (Serenity "Question" style)
      "playwright/expect-expect": [
        "warn",
        { assertFunctionPatterns: ["^expect", "^verify", "^assert"] },
      ],
      // Fixtures are often requested only for their setup side effect
      // (e.g. { checkoutCart } fills the cart), so unused fixture args are normal.
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
    },
  },
  {
    // Playwright requires the fixture argument to be destructured, so `async ({}, use)`
    // is the documented idiom for a fixture with no dependencies.
    files: ["fixtures/**/*.ts", "src/fixtures/**/*.ts"],
    rules: { "no-empty-pattern": "off" },
  },
  {
    // Vitest unit tests are not Playwright specs
    files: ["**/*.test.ts"],
    rules: { "playwright/no-standalone-expect": "off" },
  },
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
);
