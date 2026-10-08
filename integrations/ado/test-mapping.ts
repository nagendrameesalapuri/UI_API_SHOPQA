import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ParsedReport } from "../report/playwright-json-parser";
import type { SuiteSpec, TestPoint } from "./test-plans";

// Maps Playwright tests to Azure Test Cases.
// Source of the id, in order: an @TC-<id> tag in the title, a { type: "TC" } annotation,
// or data/tc-overrides.json ("file > describe > title" -> id) for tests whose titles we
// don't want to touch. Local labels like "TC-003" in titles are NOT Azure ids and are
// only treated as such when written as a tag (@TC-123).

export const mappingSchema = z.object({
  generatedAt: z.string(),
  mapped: z.array(
    z.object({
      tcId: z.number(),
      suite: z.string(),
      tests: z.array(
        z.object({ file: z.string(), title: z.string(), projects: z.array(z.string()) }),
      ),
    }),
  ),
  unmapped: z.array(z.object({ file: z.string(), title: z.string(), suite: z.string() })),
});
export type TcMapping = z.infer<typeof mappingSchema>;

/** Feature folder used as the static suite name: tests/api/cart/x.spec.ts -> "api/cart" */
export function featureSuiteFor(file: string): string {
  const parts = file
    .replace(/\\/g, "/")
    .replace(/^tests\//, "")
    .split("/");
  parts.pop();
  return parts.join("/") || "root";
}

export function buildMapping(report: ParsedReport, now = new Date()): TcMapping {
  const byTc = new Map<number, TcMapping["mapped"][number]>();
  const unmapped = new Map<string, TcMapping["unmapped"][number]>();

  for (const t of report.tests) {
    if (t.project === "setup") continue;
    const title = t.titlePath.join(" > ");
    const suite = featureSuiteFor(t.file);
    if (t.tcId === undefined) {
      unmapped.set(`${t.file}::${title}`, { file: t.file, title, suite });
      continue;
    }
    const entry = byTc.get(t.tcId) ?? { tcId: t.tcId, suite, tests: [] };
    const existing = entry.tests.find((x) => x.file === t.file && x.title === title);
    if (existing) {
      if (!existing.projects.includes(t.project)) existing.projects.push(t.project);
    } else {
      entry.tests.push({ file: t.file, title, projects: [t.project] });
    }
    byTc.set(t.tcId, entry);
  }

  return {
    generatedAt: now.toISOString(),
    mapped: [...byTc.values()].sort((a, b) => a.tcId - b.tcId),
    unmapped: [...unmapped.values()],
  };
}

/** Static suites per feature folder, holding the mapped Test Case ids. */
export function suitesFromMapping(mapping: TcMapping): {
  specs: SuiteSpec[];
  testCases: Record<string, number[]>;
} {
  const testCases: Record<string, number[]> = {};
  for (const m of mapping.mapped) (testCases[m.suite] ??= []).push(m.tcId);
  return {
    specs: Object.keys(testCases)
      .sort()
      .map((name) => ({ name, type: "static" as const })),
    testCases,
  };
}

/** Test Cases in the plan that no automated test claims. */
export function findUnautomated(
  points: TestPoint[],
  mapping: TcMapping,
): { id: number; name?: string }[] {
  const automated = new Set(mapping.mapped.map((m) => m.tcId));
  const seen = new Map<number, string | undefined>();
  for (const p of points) {
    if (!automated.has(p.testCaseReference.id))
      seen.set(p.testCaseReference.id, p.testCaseReference.name);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

export function writeMapping(file: string, mapping: TcMapping): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(mapping, null, 2) + "\n");
}

export function readMapping(file: string): TcMapping | undefined {
  if (!fs.existsSync(file)) return undefined;
  return mappingSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}
