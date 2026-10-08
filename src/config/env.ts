import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Typed, validated configuration (the TypeScript equivalent of a Serenity
// serenity.conf + a @ConfigurationProperties class).
//
// Load order: process env (CI variable groups) > .env (local secrets, gitignored)
// > src/config/environments/<TEST_ENV>.env (non-secret defaults, committed).
// dotenv never overrides a variable that is already set, so the first source wins.

const ROOT = path.resolve(__dirname, "..", "..");

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());

export const envSchema = z.object({
  TEST_ENV: z.enum(["dev", "qa", "uat"]).default("qa"),
  TARGET: z.enum(["practice", "real"]).default("real"),

  // Application under test (shop app)
  UI_BASE_URL: z.url(),
  API_BASE_URL: z.url(),

  // Credentials per role. Secrets: .env locally, variable group in CI.
  UI_TEST_ADMIN_EMAIL: z.email(),
  UI_TEST_ADMIN_PASSWORD: z.string().min(1),
  UI_TEST_CUSTOMER_EMAIL: z.email(),
  UI_TEST_CUSTOMER_PASSWORD: z.string().min(1),
  API_TEST_EMAIL: z.email(),
  API_TEST_PASSWORD: z.string().min(1),

  // AI layer: 'none' keeps every feature working with rule-based logic
  LLM_PROVIDER: z.enum(["none", "azure-openai", "anthropic", "openai-compatible"]).default("none"),

  // Azure DevOps (optional locally; required only by ado:* scripts and the dashboard)
  ADO_ORG: optionalString,
  ADO_PROJECT: optionalString,
  ADO_PAT: optionalString,
  ADO_REGRESSION_PIPELINE_ID: optionalString,

  // Optional Azure Playwright Workspaces (cloud browsers)
  PLAYWRIGHT_SERVICE_URL: optionalUrl,
});

export type Env = z.infer<typeof envSchema>;

/** Loads the env files into process.env (idempotent). */
export function loadEnvFiles(root = ROOT): void {
  dotenv.config({ path: path.join(root, ".env"), quiet: true });
  const testEnv = process.env.TEST_ENV ?? "qa";
  const envFile = path.join(root, "src", "config", "environments", `${testEnv}.env`);
  if (fs.existsSync(envFile)) dotenv.config({ path: envFile, quiet: true });
}

/** Validates a raw env record; throws one readable error listing every problem. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new Error(
      `Invalid or missing environment variables:\n${lines.join("\n")}\n` +
        "Copy .env.example to .env and fill in the values (see README).",
    );
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily loaded, validated config. Fails fast on first access when something is missing. */
export function env(): Env {
  if (!cached) {
    loadEnvFiles();
    cached = parseEnv(process.env);
  }
  return cached;
}
