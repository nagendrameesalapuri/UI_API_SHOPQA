import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ParsedReport } from "../../integrations/report/playwright-json-parser";
import { normalizeError, signatureHash } from "../rules/signature";
import { runRecordSchema, type RunRecord } from "./triage-schema";

// Triage history without a database: data/triage-history.json holds the last N runs as
// compact records (append-only, capped). In pipelines, where the workspace is fresh, the
// previous runs are rebuilt from their ai-triage artifacts (see triage.cli.ts).

export const MAX_RUNS = 30;

export const historySchema = z.object({ version: z.literal(1), runs: z.array(runRecordSchema) });
export type TriageHistory = z.infer<typeof historySchema>;

export const emptyHistory = (): TriageHistory => ({ version: 1, runs: [] });

export function loadHistory(file: string): TriageHistory {
  if (!fs.existsSync(file)) return emptyHistory();
  const parsed = historySchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  return parsed.success ? parsed.data : emptyHistory();
}

export function saveHistory(file: string, history: TriageHistory): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(history, null, 2) + "\n");
}

/** Adds runs (newest last), de-duplicated by runId, keeping the last MAX_RUNS. */
export function mergeRuns(
  history: TriageHistory,
  runs: RunRecord[],
  max = MAX_RUNS,
): TriageHistory {
  const byId = new Map(history.runs.map((r) => [r.runId, r]));
  for (const r of runs) byId.set(r.runId, r);
  const sorted = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { version: 1, runs: sorted.slice(-max) };
}

export function toRunRecord(
  report: ParsedReport,
  meta: { runId: string; date?: string; buildId?: number; buildNumber?: string },
): RunRecord {
  const results: Record<string, string> = {};
  for (const t of report.tests) {
    if (t.status === "skipped") continue;
    results[t.testId] =
      t.status === "passed"
        ? "P"
        : t.status === "flaky"
          ? "K"
          : `F:${signatureHash(normalizeError(t.errorMessage))}`;
  }
  return {
    runId: meta.runId,
    date: meta.date ?? new Date().toISOString(),
    buildId: meta.buildId,
    buildNumber: meta.buildNumber,
    results,
  };
}

export type TestHistory = {
  /** Previous runs in which the test ran */
  runs: number;
  failures: number;
  flaky: number;
  /** Consecutive previous runs (newest first) that failed with the SAME signature */
  consecutiveSameFailures: number;
  /** Consecutive previous runs that failed at all */
  consecutiveFailures: number;
  /** Pass<->fail changes across the window: high = intermittent */
  flips: number;
  failingSince?: string;
  /** Did it pass (or flake) in the most recent previous run where it ran? */
  passedLastTime: boolean;
};

export function testHistory(
  history: TriageHistory,
  testId: string,
  sigHash: string,
  window = 10,
): TestHistory {
  const outcomes = history.runs
    .filter((r) => testId in r.results)
    .slice(-window)
    .reverse() // newest first
    .map((r) => ({
      v: r.results[testId],
      label: r.buildNumber ?? (r.buildId ? `#${r.buildId}` : r.date.slice(0, 10)),
    }));

  let consecutiveSameFailures = 0;
  let consecutiveFailures = 0;
  let failingSince: string | undefined;
  for (const o of outcomes) {
    if (!o.v.startsWith("F:")) break;
    consecutiveFailures++;
    failingSince = o.label;
  }
  for (const o of outcomes) {
    if (o.v !== `F:${sigHash}`) break;
    consecutiveSameFailures++;
  }
  let flips = 0;
  for (let i = 1; i < outcomes.length; i++) {
    if (outcomes[i].v.startsWith("F:") !== outcomes[i - 1].v.startsWith("F:")) flips++;
  }
  return {
    runs: outcomes.length,
    failures: outcomes.filter((o) => o.v.startsWith("F:")).length,
    flaky: outcomes.filter((o) => o.v === "K").length,
    consecutiveSameFailures,
    consecutiveFailures,
    flips,
    failingSince,
    passedLastTime: outcomes.length > 0 && !outcomes[0].v.startsWith("F:"),
  };
}

/** Intermittent: it has both passed and failed recently and keeps switching. */
export const isIntermittent = (h: TestHistory) =>
  (h.flips >= 2 && h.failures > 0 && h.failures < h.runs) || h.flaky >= 2;
