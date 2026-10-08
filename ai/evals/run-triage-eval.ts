import { loadEnvFiles } from "../../src/config/env";
import { createLlmProvider, NoneProvider, type LlmProvider } from "../core/llm-provider";
import { runTriageEval } from "./triage-eval";

// npm run eval:triage  -> prints accuracy of the triage on the golden set.
// Uses LLM_PROVIDER (default none) so the same set measures rules alone or rules + LLM.
// Exits non-zero below EVAL_MIN_ACCURACY (default 0.9) so CI can gate rule changes.

async function main() {
  loadEnvFiles();
  let llm: LlmProvider = new NoneProvider();
  try {
    llm = createLlmProvider();
  } catch (e) {
    console.warn(`${String(e)}; evaluating rules only`);
  }
  const result = await runTriageEval(undefined, llm);

  console.log(
    `Triage eval (${llm.name === "none" ? "rules only" : `rules + ${llm.name}/${llm.model}`})\n`,
  );
  for (const r of result.rows) {
    console.log(
      `${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(36)} expected ${r.expected.padEnd(12)} got ${r.actual.padEnd(12)} ${r.confidence.toFixed(2)}  (${r.ruleId})`,
    );
  }
  console.log("\nConfusion (expected -> actual):");
  for (const [exp, row] of Object.entries(result.confusion))
    console.log(`  ${exp.padEnd(12)} ${JSON.stringify(row)}`);
  console.log(
    `\nAccuracy: ${(result.accuracy * 100).toFixed(1)}% (${result.correct}/${result.total})`,
  );

  const min = Number(process.env.EVAL_MIN_ACCURACY ?? 0.9);
  if (result.accuracy < min) {
    console.error(`Below the minimum accuracy of ${min * 100}%`);
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
