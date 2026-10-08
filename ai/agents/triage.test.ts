import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  NormalizedTest,
  ParsedReport,
} from "../../integrations/report/playwright-json-parser";
import { GuardrailError } from "../core/guardrails";
import {
  type LlmProvider,
  LlmResponseError,
  LlmUnavailableError,
  NoneProvider,
} from "../core/llm-provider";
import { runTriageEval } from "../evals/triage-eval";
import { classify, RULES } from "../rules/triage-rules";
import { normalizeError, signatureHash } from "../rules/signature";
import { triage } from "./triage.agent";
import { mergeRuns, testHistory, toRunRecord } from "./triage-history";
import { renderMarkdown, teamsMessage } from "./triage-report";
import { triageReportSchema } from "./triage-schema";

beforeAll(() => {
  // Keep audit lines from unit tests out of reports/
  process.env.AGENT_AUDIT_FILE = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "audit-")),
    "a.jsonl",
  );
});

const t = (over: Partial<NormalizedTest>): NormalizedTest => ({
  testId: over.title ?? "id",
  title: "t",
  titlePath: [over.title ?? "t"],
  file: "f.spec.ts",
  project: "chromium",
  tags: [],
  status: "failed",
  retries: 0,
  attachments: [],
  duration: 10,
  ...over,
});
const report = (tests: NormalizedTest[], passed = 0): ParsedReport => ({
  tests,
  failures: tests.filter((x) => x.status !== "passed"),
  stats: {
    total: tests.length + passed,
    passed,
    failed: tests.length,
    flaky: 0,
    skipped: 0,
    durationMs: 1000,
  },
  globalErrors: [],
});

class FakeLlm implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model = "fake";
  prompts: string[] = [];
  constructor(private readonly answer: () => unknown) {}
  async complete(): Promise<string> {
    return "";
  }
  async json<T>(schema: z.ZodType<T>, prompt: string): Promise<T> {
    this.prompts.push(prompt);
    return schema.parse(this.answer());
  }
  usage() {
    return { calls: this.prompts.length, spentUsd: 0.001 };
  }
}

describe("triage rules", () => {
  it("every rule has an id, a reason and at least one condition", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RULES) expect(r.anyOf ?? r.when, r.id).toBeDefined();
  });

  it("an expected 401 that did not happen is not an auth problem", () => {
    expect(
      classify({ status: "failed", errorMessage: "Expected: 401\nReceived: 200" }).category,
    ).toBe("PRODUCT_BUG");
  });

  it("an element that was found but has the wrong text is not a locator problem", () => {
    const msg =
      'Error: expect(locator).toHaveText(expected) failed\nExpected: "a"\nReceived: "b"\n  - locator resolved to <span>b</span>';
    expect(classify({ status: "failed", errorMessage: msg }).ruleId).toBe(
      "assertion-value-mismatch",
    );
  });
});

describe("signature", () => {
  it("normalises run-specific values so one root cause = one signature", () => {
    const a = normalizeError(
      "Error: Get order 7d9f1c2a-1111-4222-8333-944455556666 failed. Status: 503 at https://api.x/orders after 1200ms",
    );
    const b = normalizeError(
      "Error: Get order 0a0a0a0a-1111-4222-8333-944455556666 failed. Status: 503 at https://api.y/orders after 30ms",
    );
    expect(a).toBe(b);
    expect(signatureHash(a)).toHaveLength(8);
  });
});

describe("history", () => {
  it("detects consecutive same-signature failures and intermittency", () => {
    const sig = signatureHash(normalizeError("boom"));
    const runs = ["P", `F:${sig}`, `F:${sig}`].map((v, i) => ({
      runId: `r${i}`,
      date: `2026-01-0${i + 1}`,
      buildNumber: `B${i}`,
      results: { x: v },
    }));
    const h = testHistory({ version: 1, runs }, "x", sig);
    expect(h).toMatchObject({
      runs: 3,
      failures: 2,
      consecutiveSameFailures: 2,
      failingSince: "B1",
      passedLastTime: false,
    });
  });

  it("mergeRuns de-duplicates by runId and caps the length", () => {
    const run = (id: string, d: string) => ({ runId: id, date: d, results: {} });
    const merged = mergeRuns(
      { version: 1, runs: [run("a", "1"), run("b", "2")] },
      [run("b", "2"), run("c", "3")],
      2,
    );
    expect(merged.runs.map((r) => r.runId)).toEqual(["b", "c"]);
  });

  it("toRunRecord stores pass / flaky / failure signature", () => {
    const rec = toRunRecord(
      report([
        t({ title: "a", status: "passed" }),
        t({ title: "b", status: "flaky" }),
        t({ title: "c", errorMessage: "x" }),
      ]),
      { runId: "1" },
    );
    expect(Object.values(rec.results).map((v) => v[0])).toEqual(["P", "K", "F"]);
  });
});

describe("triage agent", () => {
  const failures = [
    t({ title: "a", errorMessage: "Error: Get cart failed. Status: 503" }),
    t({ title: "b", errorMessage: "Error: Get cart failed. Status: 503", project: "firefox" }),
    t({ title: "c", errorMessage: "TypeError: Cannot read properties of undefined (reading 'x')" }),
    t({
      title: "d",
      status: "flaky",
      retries: 1,
      errorMessage: "flaky",
      attachments: [{ name: "trace", path: "t.zip" }],
    }),
  ];

  it("works with LLM_PROVIDER=none: clusters, totals, schema-valid output", async () => {
    const r = await triage(report(failures, 6), { runId: "1", llm: new NoneProvider() });
    expect(triageReportSchema.safeParse(r).success).toBe(true);
    expect(r.totals).toMatchObject({ ENVIRONMENT: 2, UNKNOWN: 1, FLAKY: 1 });
    expect(r.clusters[0]).toMatchObject({ category: "ENVIRONMENT", count: 2 });
    expect(r.stats.passRate).toBeCloseTo(0.6);
    expect(r.llm).toMatchObject({ provider: "none", calls: 0 });
  });

  it("asks the LLM only for uncertain clusters, with redacted input, and merges a more confident answer", async () => {
    const llm = new FakeLlm(() => ({
      category: "TEST_ISSUE",
      confidence: 0.8,
      reason: "Page object reads a missing field",
      suggestedFix: "null check",
    }));
    const withEmail = [
      ...failures.slice(0, 2),
      t({
        title: "c",
        errorMessage: "TypeError: Cannot read properties of undefined (user someone@example.test)",
      }),
    ];
    const r = await triage(report(withEmail), { runId: "1", llm });
    expect(llm.prompts).toHaveLength(1); // the 503 cluster is confident: not sent
    expect(llm.prompts[0]).not.toContain("someone@example.test");
    expect(llm.prompts[0]).toContain("[EMAIL]");
    const c = r.items.find((i) => i.title === "c")!;
    expect(c).toMatchObject({ category: "TEST_ISSUE", source: "llm", suggestedFix: "null check" });
  });

  it.each([
    ["unavailable", new LlmUnavailableError("none")],
    ["guardrail", new GuardrailError("budget")],
    ["bad answer", new LlmResponseError("invalid JSON twice")],
  ])("keeps the rule result when the LLM fails (%s)", async (_, error) => {
    const llm = new FakeLlm(() => {
      throw error;
    });
    const r = await triage(report([failures[2]]), { runId: "1", llm });
    expect(r.items[0]).toMatchObject({ category: "UNKNOWN", source: "rules" });
  });

  it("ignores an LLM answer that is less confident than the rules", async () => {
    const llm = new FakeLlm(() => ({ category: "PRODUCT_BUG", confidence: 0.3, reason: "maybe" }));
    const timeout = t({
      title: "slow",
      status: "timedOut",
      errorMessage: "Test timeout of 30000ms exceeded.",
    });
    const r = await triage(report([timeout]), { runId: "1", llm });
    expect(r.items[0]).toMatchObject({ category: "TEST_ISSUE", source: "rules" });
  });

  it("applies known issues before rules", async () => {
    const r = await triage(report([failures[0]]), {
      runId: "1",
      knownIssues: [
        {
          id: "KI-1",
          pattern: "Get cart failed",
          category: "PRODUCT_BUG",
          kind: "known-issue",
          reason: "Cart API bug",
          bugId: 42,
        },
      ],
    });
    expect(r.items[0]).toMatchObject({
      category: "PRODUCT_BUG",
      source: "known-issue",
      confidence: 0.95,
    });
  });

  it("renders markdown and a Teams card", async () => {
    const r = await triage(report(failures, 6), {
      runId: "42",
      releaseVersion: "2026.10",
      buildUrl: "https://ado/b/42",
    });
    const md = renderMarkdown(r, {
      calls: 2,
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 0.01,
      byAgent: { triage: { calls: 2, costUsd: 0.01 } },
    });
    expect(md).toContain("release 2026.10");
    expect(md).toContain("## Top clusters");
    expect(md).toContain("## Flaky (1)");
    expect(md).toContain("## AI cost");
    expect(JSON.stringify(teamsMessage(r))).toContain("https://ado/b/42");
  });
});

describe("golden eval", () => {
  it("rules alone reach at least 90% accuracy on the golden set", async () => {
    const result = await runTriageEval();
    expect(result.total).toBe(23);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.9);
  });
});
