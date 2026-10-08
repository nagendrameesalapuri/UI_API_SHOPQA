import fs from "node:fs";
import { z } from "zod";
import type { NormalizedTest, ParsedReport, TestStatus } from "../report/playwright-json-parser";
import type { AdoClient } from "./ado-client";
import { getAllTestPoints } from "./test-plans";

// Publishes Playwright results to the test points of an Azure Test Plan:
// create an automated run for the points -> PATCH each result -> complete the run.
// REST: https://learn.microsoft.com/rest/api/azure/devops/test (7.1)

export type AdoOutcome = "Passed" | "Failed" | "Timeout" | "Aborted" | "NotExecuted";

const OUTCOME: Record<TestStatus, AdoOutcome> = {
  passed: "Passed",
  flaky: "Passed", // passed on retry; flagged in the comment
  failed: "Failed",
  timedOut: "Timeout",
  interrupted: "Aborted",
  skipped: "NotExecuted",
};

// When one Test Case is covered by several Playwright tests/projects, the worst outcome wins
const SEVERITY: AdoOutcome[] = ["NotExecuted", "Passed", "Aborted", "Timeout", "Failed"];

export type TcResult = {
  tcId: number;
  outcome: AdoOutcome;
  durationInMs: number;
  errorMessage?: string;
  stackTrace?: string;
  comment: string;
  automatedTestName: string;
  automatedTestStorage: string;
  screenshot?: string;
};

export function aggregateByTestCase(tests: NormalizedTest[]): Map<number, TcResult> {
  const out = new Map<number, TcResult>();
  for (const t of tests) {
    if (t.tcId === undefined) continue;
    const outcome = OUTCOME[t.status];
    const retries = t.retries ? ` after ${t.retries} ${t.retries === 1 ? "retry" : "retries"}` : "";
    const note = `${t.project}: ${t.status}${retries}`;
    const screenshot = t.attachments.find((a) => a.contentType === "image/png" && a.path)?.path;
    const current = out.get(t.tcId);
    if (!current) {
      out.set(t.tcId, {
        tcId: t.tcId,
        outcome,
        durationInMs: t.duration,
        errorMessage: t.errorMessage?.slice(0, 4000),
        stackTrace: t.stack?.slice(0, 8000),
        comment: note,
        automatedTestName: t.titlePath.join(" > "),
        automatedTestStorage: t.file,
        screenshot: outcome === "Passed" ? undefined : screenshot,
      });
      continue;
    }
    current.durationInMs += t.duration;
    current.comment += `; ${note}`;
    if (SEVERITY.indexOf(outcome) > SEVERITY.indexOf(current.outcome)) {
      current.outcome = outcome;
      current.errorMessage = t.errorMessage?.slice(0, 4000);
      current.stackTrace = t.stack?.slice(0, 8000);
      current.screenshot = screenshot;
    }
  }
  return out;
}

const runSchema = z
  .object({ id: z.number(), name: z.string().optional(), webAccessUrl: z.string().optional() })
  .loose();
const runResultsSchema = z.object({
  value: z.array(
    z
      .object({
        id: z.number(),
        testPoint: z.object({ id: z.coerce.number() }).loose().optional(),
        testCase: z.object({ id: z.coerce.number() }).loose().optional(),
      })
      .loose(),
  ),
});

export type PublishSummary = {
  runId?: number;
  runUrl?: string;
  published: number;
  byOutcome: Partial<Record<AdoOutcome, number>>;
  /** Test Case ids in results.json that are not in the plan */
  notInPlan: number[];
  attachments: number;
};

export type PublishOptions = {
  planId: number;
  report: ParsedReport;
  runName?: string;
  buildId?: number;
  /** Link written into every non-passing result (e.g. the build's artifacts page with traces) */
  artifactsUrl?: string;
  uploadScreenshots?: boolean;
};

export async function publishResultsToPlan(
  client: AdoClient,
  opts: PublishOptions,
): Promise<PublishSummary> {
  const byTc = aggregateByTestCase(opts.report.tests);
  const points = await getAllTestPoints(client, opts.planId);
  const pointsInScope = points.filter((p) => byTc.has(p.testCaseReference.id));
  const planTcs = new Set(points.map((p) => p.testCaseReference.id));
  const notInPlan = [...byTc.keys()].filter((id) => !planTcs.has(id));

  if (pointsInScope.length === 0) {
    return { published: 0, byOutcome: {}, notInPlan, attachments: 0 };
  }

  const run = await client.post("test/runs", {
    schema: runSchema,
    body: {
      name: opts.runName ?? `Playwright ${new Date().toISOString()}`,
      plan: { id: String(opts.planId) },
      pointIds: pointsInScope.map((p) => p.id),
      automated: true,
      state: "InProgress",
      ...(opts.buildId ? { build: { id: String(opts.buildId) } } : {}),
    },
  });

  try {
    const { value: results } = await client.get(`test/Runs/${run.id}/results`, {
      schema: runResultsSchema,
      query: { $top: 1000 },
    });
    const tcOf = (r: (typeof results)[number]) =>
      r.testCase?.id ?? points.find((p) => p.id === r.testPoint?.id)?.testCaseReference.id;

    const byOutcome: PublishSummary["byOutcome"] = {};
    const updates = results.flatMap((r) => {
      const tcId = tcOf(r);
      const res = tcId === undefined ? undefined : byTc.get(tcId);
      if (!res) return [];
      byOutcome[res.outcome] = (byOutcome[res.outcome] ?? 0) + 1;
      const link =
        res.outcome !== "Passed" && opts.artifactsUrl ? `\nTrace/report: ${opts.artifactsUrl}` : "";
      return [
        {
          id: r.id,
          outcome: res.outcome,
          state: "Completed",
          durationInMs: res.durationInMs,
          errorMessage: res.errorMessage,
          stackTrace: res.stackTrace,
          comment: (res.comment + link).slice(0, 1000),
          automatedTestName: res.automatedTestName.slice(0, 256),
          automatedTestStorage: res.automatedTestStorage,
        },
      ];
    });
    await client.patch(`test/Runs/${run.id}/results`, { schema: z.unknown(), body: updates });

    let attachments = 0;
    if (opts.uploadScreenshots !== false) {
      for (const r of results) {
        const tcId = tcOf(r);
        const shot = tcId === undefined ? undefined : byTc.get(tcId)?.screenshot;
        if (!shot || !fs.existsSync(shot) || fs.statSync(shot).size > 5_000_000) continue;
        await client.post(`test/Runs/${run.id}/Results/${r.id}/attachments`, {
          schema: z.unknown(),
          body: {
            stream: fs.readFileSync(shot).toString("base64"),
            fileName: "failure.png",
            comment: "Screenshot at failure",
            attachmentType: "GeneralAttachment",
          },
        });
        attachments++;
      }
    }

    return {
      runId: run.id,
      runUrl: run.webAccessUrl,
      published: updates.length,
      byOutcome,
      notInPlan,
      attachments,
    };
  } finally {
    // Always close the run, even if a PATCH failed, so it never stays "In progress"
    await client.patch(`test/runs/${run.id}`, {
      schema: z.unknown(),
      body: { state: "Completed" },
    });
  }
}
