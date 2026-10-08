import { z } from "zod";
import type { TriageReport } from "../../ai/agents/triage-schema";
import type { TimelineRecord } from "../../integrations/ado/pipelines";
import {
  runSummarySchema,
  type NewRunRequest,
  type Release,
  type RunProgress,
  type RunResults,
  type RunSummary,
  type StepState,
  type TrendPoint,
} from "../shared/contracts";

// What the HTTP layer needs. Two implementations: AdoDashboardService (real Azure DevOps)
// and MockDashboardService (DASHBOARD_MOCK=true). Routes never know which one they talk to.

export interface DashboardService {
  startRun(req: NewRunRequest, user?: string): Promise<RunSummary>;
  listRuns(): Promise<RunSummary[]>;
  getProgress(runId: string): Promise<RunProgress | undefined>;
  /** undefined while results are not available yet */
  getResults(runId: string): Promise<RunResults | undefined>;
  getTrend(count: number): Promise<TrendPoint[]>;
  listReleases(): Promise<Release[]>;
}

export class NotFoundError extends Error {
  name = "NotFoundError";
}

/** Locally remembered run (the link release -> plan -> pipeline run). */
export const runRecordSchema = runSummarySchema.pick({
  id: true,
  releaseVersion: true,
  environment: true,
  grep: true,
  planId: true,
  planUrl: true,
  pipelineRunId: true,
  buildUrl: true,
  createdAt: true,
});
export type DashboardRunRecord = z.infer<typeof runRecordSchema>;

// ---- Pure helpers (unit-tested) ----

const STAGE_FOR_STEP = {
  running: "Test",
  reports: "Report",
  triage: "Triage",
  published: "Publish",
} as const;

function stageState(r: TimelineRecord | undefined): StepState {
  if (!r) return "pending";
  if (r.state === "inProgress") return "running";
  if (r.state !== "completed") return "pending";
  if (r.result === "skipped") return "skipped";
  if (r.result === "failed" || r.result === "canceled" || r.result === "abandoned") return "failed";
  return "done"; // succeeded / succeededWithIssues
}

/** Maps a pipeline timeline (stages/jobs) to the dashboard's progress steps. */
export function progressFromTimeline(
  record: DashboardRunRecord,
  run: { state: string; result?: string | null } | undefined,
  timeline: TimelineRecord[],
): Omit<RunProgress, "run"> {
  const stage = (name: string) =>
    timeline.find((t) => t.type === "Stage" && (t.name === name || t.id === name));
  const testStage = stage("Test");
  const shards = timeline
    .filter(
      (t) =>
        t.type === "Job" &&
        (!testStage || timeline.some((p) => p.id === t.parentId && p.parentId === testStage.id)),
    )
    .filter((t) => /Regression|Playwright|Smoke/i.test(t.name))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((t) => ({ name: t.name, state: stageState(t) }));

  const steps: RunProgress["steps"] = [
    {
      id: "plan",
      label: "Test Plan created",
      state: record.planId ? "done" : "pending",
      detail: record.planId ? `Plan ${record.planId}` : undefined,
    },
    {
      id: "queued",
      label: "Pipeline queued",
      state: record.pipelineRunId ? "done" : "pending",
      detail: record.pipelineRunId ? `Run ${record.pipelineRunId}` : undefined,
    },
    {
      id: "running",
      label: "Running tests",
      state: stageState(testStage),
      detail: shards.length
        ? `${shards.filter((s) => s.state === "done" || s.state === "failed").length}/${shards.length} shards finished`
        : undefined,
    },
    { id: "reports", label: "Reports merged", state: stageState(stage(STAGE_FOR_STEP.reports)) },
    { id: "triage", label: "Failures triaged", state: stageState(stage(STAGE_FOR_STEP.triage)) },
    {
      id: "published",
      label: "Results published to Test Plan",
      state: stageState(stage(STAGE_FOR_STEP.published)),
    },
  ];
  // The Test stage "fails" when tests fail; that is an outcome, not a broken step
  if (steps[2].state === "failed")
    steps[2].detail = `${steps[2].detail ?? ""} (test failures)`.trim();

  const finished = run?.state === "completed";
  if (finished) {
    for (const s of steps) if (s.state === "pending") s.state = "skipped";
  }
  return { steps, shards, done: finished };
}

export function statusOf(
  run: { state: string; result?: string | null } | undefined,
): RunSummary["status"] {
  if (!run) return "queued";
  if (run.state === "completed")
    return run.result === "succeeded" || run.result === "succeededWithIssues"
      ? "completed"
      : "failed";
  return run.state === "inProgress" ? "running" : "queued";
}

export function toRunResults(
  report: TriageReport,
  links: RunResults["links"],
  testCaseUrl: (id: number) => string | undefined = () => undefined,
): RunResults {
  return {
    runId: report.run.runId,
    releaseVersion: report.run.releaseVersion,
    kpis: { ...report.stats },
    totals: report.totals,
    clusters: report.clusters.map((c) => ({
      signatureHash: c.signatureHash,
      category: c.category,
      kind: c.kind,
      confidence: c.confidence,
      reason: c.reason,
      count: c.count,
      sampleError: c.sampleError,
      isNew: c.isNew,
      bugId: c.bugId,
      bugUrl: c.bugUrl,
    })),
    failures: report.items.map((i) => ({
      title: i.title,
      file: i.file,
      project: i.project,
      category: i.category,
      kind: i.kind,
      confidence: i.confidence,
      reason: i.reason,
      errorSummary: i.errorSummary,
      signatureHash: i.signatureHash,
      isNew: i.isNew,
      tcId: i.tcId,
      testCaseUrl: i.tcId ? testCaseUrl(i.tcId) : undefined,
    })),
    links,
  };
}

export function groupReleases(runs: RunSummary[]): Release[] {
  const byRelease = new Map<string, RunSummary[]>();
  for (const r of runs)
    byRelease.set(r.releaseVersion, [...(byRelease.get(r.releaseVersion) ?? []), r]);
  return [...byRelease]
    .map(([releaseVersion, rs]) => {
      const sorted = [...rs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        releaseVersion,
        planId: sorted.find((r) => r.planId)?.planId,
        planUrl: sorted.find((r) => r.planUrl)?.planUrl,
        runs: sorted,
        latestOutcome:
          sorted[0].status === "completed" || sorted[0].status === "failed"
            ? `${sorted[0].status}${sorted[0].passRate !== undefined ? ` (${(sorted[0].passRate * 100).toFixed(1)}% pass)` : ""}`
            : sorted[0].status,
      };
    })
    .sort((a, b) => b.runs[0].createdAt.localeCompare(a.runs[0].createdAt));
}
