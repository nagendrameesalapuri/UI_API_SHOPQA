import { z } from "zod";
import { triageReportSchema, type TriageReport } from "../../ai/agents/triage-schema";
import { audit } from "../../ai/core/audit";
import type { AdoClient } from "../../integrations/ado/ado-client";
import {
  getRun,
  getTimeline,
  listRuns,
  queueRun,
  readArtifactJson,
  type PipelineRun,
} from "../../integrations/ado/pipelines";
import { readMapping, suitesFromMapping } from "../../integrations/ado/test-mapping";
import { addTestCases, createReleasePlan, ensureSuites } from "../../integrations/ado/test-plans";
import { workItemWebUrl } from "../../integrations/ado/work-items";
import type { Store } from "../../integrations/store/store";
import type {
  NewRunRequest,
  Release,
  RunProgress,
  RunResults,
  RunSummary,
  TrendPoint,
} from "../shared/contracts";
import {
  type DashboardRunRecord,
  type DashboardService,
  groupReleases,
  NotFoundError,
  progressFromTimeline,
  runRecordSchema,
  statusOf,
  toRunResults,
} from "./service";

// Real implementation. Azure DevOps is the source of truth; the Store only caches
// (TTL) and remembers which pipeline run belongs to which release/plan. Delete
// dashboard/.cache at any time: nothing is lost except speed and that link for runs
// started from the dashboard (the pipeline run itself still carries releaseVersion).

const RUNS_KEY = "dashboard-runs";
const LIVE_TTL = 10_000;

export type AdoServiceConfig = {
  pipelineId: number;
  branch: string;
  mappingFile: string;
  areaPath?: string;
  iteration?: string;
};

export class AdoDashboardService implements DashboardService {
  constructor(
    private readonly ado: AdoClient,
    private readonly store: Store,
    private readonly cfg: AdoServiceConfig,
  ) {}

  private async records(): Promise<DashboardRunRecord[]> {
    return (await this.store.get(RUNS_KEY, z.array(runRecordSchema))) ?? [];
  }

  private async cached<T>(
    key: string,
    schema: z.ZodType<T>,
    ttlMs: number | undefined,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = await this.store.get(key, schema);
    if (hit !== undefined) return hit;
    const value = await load();
    await this.store.set(key, value, ttlMs);
    return value;
  }

  private run(runId: number): Promise<PipelineRun> {
    return this.cached(
      `run-${runId}`,
      z
        .object({
          id: z.number(),
          state: z.string(),
          result: z.string().nullish(),
          createdDate: z.string().optional(),
          templateParameters: z.record(z.string(), z.unknown()).nullish(),
        })
        .loose(),
      LIVE_TTL,
      () => getRun(this.ado, this.cfg.pipelineId, runId),
    ) as Promise<PipelineRun>;
  }

  async startRun(req: NewRunRequest, user?: string): Promise<RunSummary> {
    const { plan } = await createReleasePlan(this.ado, {
      releaseVersion: req.releaseVersion,
      areaPath: this.cfg.areaPath,
      iteration: this.cfg.iteration,
    });

    const mapping = readMapping(this.cfg.mappingFile);
    if (mapping) {
      const { specs, testCases } = suitesFromMapping(mapping);
      const wanted = req.suites.length ? specs.filter((s) => req.suites.includes(s.name)) : specs;
      const ids = await ensureSuites(this.ado, plan.id, wanted);
      for (const s of wanted) await addTestCases(this.ado, plan.id, ids[s.name], testCases[s.name]);
    }

    const run = await queueRun(
      this.ado,
      this.cfg.pipelineId,
      {
        releaseVersion: req.releaseVersion,
        testPlanId: plan.id,
        environment: req.environment,
        grep: req.grep,
      },
      this.cfg.branch,
    );
    const record: DashboardRunRecord = {
      id: String(run.id),
      releaseVersion: req.releaseVersion,
      environment: req.environment,
      grep: req.grep,
      planId: plan.id,
      planUrl: this.ado.webUrl(`_testPlans/execute?planId=${plan.id}`),
      pipelineRunId: run.id,
      buildUrl: run._links?.web?.href ?? this.ado.webUrl(`_build/results?buildId=${run.id}`),
      createdAt: run.createdDate ?? new Date().toISOString(),
    };
    await this.store.set(RUNS_KEY, [record, ...(await this.records())].slice(0, 500));
    audit({
      agent: "dashboard",
      action: "start-run",
      inputs: req,
      outcome: "ok",
      details: { user, planId: plan.id, runId: run.id },
    });
    return { ...record, status: "queued" };
  }

  async listRuns(): Promise<RunSummary[]> {
    const out: RunSummary[] = [];
    for (const r of (await this.records()).slice(0, 50)) {
      const run = r.pipelineRunId
        ? await this.run(r.pipelineRunId).catch(() => undefined)
        : undefined;
      const results =
        run?.state === "completed" ? await this.getResults(r.id).catch(() => undefined) : undefined;
      out.push({
        ...r,
        status: statusOf(run),
        result: run?.result ?? undefined,
        passRate: results?.kpis.passRate,
      });
    }
    return out;
  }

  async getProgress(runId: string): Promise<RunProgress | undefined> {
    const record = (await this.records()).find((r) => r.id === runId);
    if (!record) throw new NotFoundError(`Run ${runId} was not started from this dashboard`);
    const run = record.pipelineRunId ? await this.run(record.pipelineRunId) : undefined;
    const timeline = record.pipelineRunId ? await getTimeline(this.ado, record.pipelineRunId) : [];
    return {
      run: { ...record, status: statusOf(run), result: run?.result ?? undefined },
      ...progressFromTimeline(record, run, timeline),
    };
  }

  private async triageReport(buildId: number): Promise<TriageReport | undefined> {
    const key = `triage-${buildId}`;
    const hit = await this.store.get(key, triageReportSchema);
    if (hit) return hit;
    const report = await readArtifactJson(
      this.ado,
      buildId,
      "ai-triage",
      "ai-triage.json",
      triageReportSchema,
    );
    if (report) await this.store.set(key, report); // completed runs never change: no TTL
    return report;
  }

  async getResults(runId: string): Promise<RunResults | undefined> {
    const buildId = Number(runId);
    if (!Number.isInteger(buildId)) throw new NotFoundError(`Unknown run ${runId}`);
    const report = await this.triageReport(buildId);
    if (!report) return undefined;
    const record = (await this.records()).find((r) => r.id === runId);
    return toRunResults(
      report,
      {
        build: this.ado.webUrl(`_build/results?buildId=${buildId}`),
        artifacts: this.ado.webUrl(`_build/results?buildId=${buildId}&view=artifacts`),
        testPlan: record?.planUrl,
      },
      (id) => workItemWebUrl(this.ado, id),
    );
  }

  async getTrend(count: number): Promise<TrendPoint[]> {
    const runs = await this.cached(
      "pipeline-runs",
      z.array(
        z
          .object({
            id: z.number(),
            state: z.string(),
            result: z.string().nullish(),
            createdDate: z.string().optional(),
            name: z.string().optional(),
          })
          .loose(),
      ),
      60_000,
      () => listRuns(this.ado, this.cfg.pipelineId, 50),
    );
    const points: TrendPoint[] = [];
    for (const run of runs.filter((r) => r.state === "completed")) {
      if (points.length >= count) break;
      const report = await this.triageReport(run.id).catch(() => undefined);
      if (!report) continue;
      points.push({
        runId: String(run.id),
        label: String(run.name ?? run.id),
        date: run.createdDate ?? report.generatedAt,
        passRate: report.stats.passRate,
        flaky: report.stats.flaky,
        failed: report.stats.failed,
        durationMs: report.stats.durationMs,
      });
    }
    return points.reverse();
  }

  async listReleases(): Promise<Release[]> {
    return groupReleases(await this.listRuns());
  }
}
