import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// JSON-lines usage log: one line per LLM call (reports/ai-usage.jsonl). Lets us answer
// "what did the AI cost this run, per agent and per prompt version?" without a database.

export const usageSchema = z.object({
  ts: z.string(),
  agent: z.string(),
  promptId: z.string(),
  promptVersion: z.string(),
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  ms: z.number(),
  ok: z.boolean(),
});
export type UsageEntry = z.infer<typeof usageSchema>;

export const DEFAULT_USAGE_FILE = path.join("reports", "ai-usage.jsonl");

/** Price per 1k tokens comes from env, because it depends on the contract/model. */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const inPrice = Number(env.LLM_PRICE_INPUT_PER_1K ?? 0);
  const outPrice = Number(env.LLM_PRICE_OUTPUT_PER_1K ?? 0);
  return (inputTokens / 1000) * inPrice + (outputTokens / 1000) * outPrice;
}

export function appendUsage(entry: Omit<UsageEntry, "ts">, file = DEFAULT_USAGE_FILE): UsageEntry {
  const full = { ts: new Date().toISOString(), ...entry };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(full) + "\n");
  return full;
}

export function readUsage(file = DEFAULT_USAGE_FILE): UsageEntry[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const parsed = usageSchema.safeParse(JSON.parse(line));
      return parsed.success ? [parsed.data] : [];
    });
}

export type UsageSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  byAgent: Record<string, { calls: number; costUsd: number }>;
};

export function summarizeUsage(entries: UsageEntry[]): UsageSummary {
  const summary: UsageSummary = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    byAgent: {},
  };
  for (const e of entries) {
    summary.calls++;
    summary.inputTokens += e.inputTokens;
    summary.outputTokens += e.outputTokens;
    summary.costUsd += e.costUsd;
    const a = (summary.byAgent[e.agent] ??= { calls: 0, costUsd: 0 });
    a.calls++;
    a.costUsd += e.costUsd;
  }
  return summary;
}
