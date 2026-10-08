import type { TriageReport } from "../../ai/agents/triage-schema";
import type { TimelineRecord } from "../../integrations/ado/pipelines";
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
  statusOf,
  toRunResults,
} from "./service";

// DASHBOARD_MOCK=true: the full flow without Azure DevOps. A started run moves through
// the pipeline stages on a timer (stepSeconds per stage), then serves a realistic triage
// report. Uses the same pure mapping functions as the real service, so the UI exercised
// in the demo is the UI used in production.

const MOCK_ORG = "https://dev.azure.com/mock-org/ShopQA";

function sampleReport(runId: string, releaseVersion: string, seed: number): TriageReport {
  const failing = [
    {
      title: "Checkout > @Regression Pay by card",
      file: "ui/regression/CheckoutTests.spec.ts",
      project: "chromium",
      category: "ENVIRONMENT" as const,
      kind: "backend",
      confidence: 0.85,
      reason: "Backend answered with a 5xx / gateway error.",
      error: "Error: Place order failed. Status: 503",
      sig: "a1b2c3d4",
      tcId: 5101,
    },
    {
      title: "@API Orders > Cancel a placed order",
      file: "api/orders/orders.spec.ts",
      project: "api",
      category: "ENVIRONMENT" as const,
      kind: "backend",
      confidence: 0.85,
      reason: "Backend answered with a 5xx / gateway error.",
      error: "Error: Place order failed. Status: 503",
      sig: "a1b2c3d4",
      tcId: 5102,
    },
    {
      title: "Coupons > @Regression FLAT500 reduces the total",
      file: "ui/regression/CouponTests.spec.ts",
      project: "chromium",
      category: "PRODUCT_BUG" as const,
      kind: "assertion",
      confidence: 0.8,
      reason:
        "A business value differs from the expected one. Consistently failing since build 20261001.3 (3 runs in a row).",
      error: 'Expected: "₹1,490" Received: "₹1,990"',
      sig: "e5f6a7b8",
      tcId: 5103,
    },
    {
      title: "Wishlist > @Regression Move item to cart",
      file: "ui/regression/ProfileWishlistTests.spec.ts",
      project: "firefox",
      category: "TEST_ISSUE" as const,
      kind: "locator",
      confidence: 0.75,
      reason: "Element never appeared: the locator is probably stale after a UI change.",
      error: "TimeoutError: locator.click: Timeout 10000ms exceeded.",
      sig: "c9d0e1f2",
      tcId: undefined,
    },
    {
      title: "Catalog > @Regression Sort by rating",
      file: "ui/regression/ProductCatalogTests.spec.ts",
      project: "chromium",
      category: "FLAKY" as const,
      kind: "retry",
      confidence: 0.9,
      reason: "Failed first, then passed on retry.",
      error: "Error: expect(received).toEqual(expected)",
      sig: "13579bdf",
      tcId: 5104,
    },
  ].slice(0, 3 + (seed % 3));

  const items = failing.map((f) => ({
    testId: `${f.file}::${f.title}::${f.project}`,
    title: f.title,
    file: f.file,
    project: f.project,
    tags: ["@Regression"],
    tcId: f.tcId,
    status: f.category === "FLAKY" ? "flaky" : "failed",
    retries: f.category === "FLAKY" ? 1 : 2,
    errorSummary: f.error,
    attachments: [],
    duration: 12000,
    category: f.category,
    kind: f.kind,
    confidence: f.confidence,
    reason: f.reason,
    ruleId: "mock",
    source: "rules" as const,
    signature: f.error,
    signatureHash: f.sig,
    isNew: f.category !== "PRODUCT_BUG",
    history: { runs: 5, failures: 1, consecutiveFailures: 0 },
  }));
  const clusters = [...new Set(items.map((i) => i.signatureHash))].map((sig) => {
    const group = items.filter((i) => i.signatureHash === sig);
    const i = group[0];
    return {
      signatureHash: sig,
      signature: i.signature,
      category: i.category,
      kind: i.kind,
      confidence: i.confidence,
      reason: i.reason,
      count: group.length,
      isNew: i.isNew,
      tests: group.map((g) => ({ title: g.title, file: g.file, project: g.project, tcId: g.tcId })),
      sampleError: i.errorSummary,
      ...(i.category === "PRODUCT_BUG"
        ? { bugId: 9001, bugUrl: `${MOCK_ORG}/_workitems/edit/9001` }
        : {}),
    };
  });
  const flaky = items.filter((i) => i.category === "FLAKY").length;
  const failed = items.length - flaky;
  const total = 236;
  const skipped = 4;
  const passed = total - failed - flaky - skipped;
  const totals = { PRODUCT_BUG: 0, ENVIRONMENT: 0, TEST_ISSUE: 0, FLAKY: 0, UNKNOWN: 0 };
  for (const i of items) totals[i.category]++;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    run: { runId, releaseVersion },
    llm: { provider: "none", model: "none", calls: 0, costUsd: 0 },
    stats: {
      total,
      passed,
      failed,
      flaky,
      skipped,
      durationMs: 1_260_000 + (seed % 10) * 30_000,
      passRate: Number(((passed + flaky) / (total - skipped)).toFixed(4)),
    },
    totals,
    items,
    clusters,
    globalErrors: [],
    runRecord: { runId, date: new Date().toISOString(), results: {} },
  };
}

export class MockDashboardService implements DashboardService {
  private runs: DashboardRunRecord[] = [];
  private nextId = 4100;

  constructor(
    private readonly stepSeconds = 12,
    private readonly now: () => number = Date.now,
  ) {
    // Two past releases so history and trend are not empty
    const day = 86_400_000;
    for (const [i, version] of ["2026.09.2", "2026.10"].entries()) {
      this.runs.push(
        this.record(
          { releaseVersion: version, environment: "uat", grep: "@Regression", suites: [] },
          new Date(this.now() - (3 - i) * day - 3_600_000),
        ),
      );
    }
  }

  private record(req: NewRunRequest, created = new Date(this.now())): DashboardRunRecord {
    const id = String(this.nextId++);
    const planId = 300 + (Number(id) % 100);
    return {
      id,
      releaseVersion: req.releaseVersion,
      environment: req.environment,
      grep: req.grep,
      planId,
      planUrl: `${MOCK_ORG}/_testPlans/execute?planId=${planId}`,
      pipelineRunId: Number(id),
      buildUrl: `${MOCK_ORG}/_build/results?buildId=${id}`,
      createdAt: created.toISOString(),
    };
  }

  /** Simulated pipeline: Test (4 shards) -> Report -> Triage -> Publish, one stage per stepSeconds. */
  private simulate(r: DashboardRunRecord): {
    run: { state: string; result: string | null };
    timeline: TimelineRecord[];
  } {
    const elapsed = (this.now() - Date.parse(r.createdAt)) / 1000;
    const s = this.stepSeconds;
    const stageAt = (start: number, end: number) =>
      elapsed < start ? undefined : elapsed < end ? "inProgress" : "completed";
    const stages: [string, number, number, string][] = [
      ["Test", 0, 3 * s, "failed"],
      ["Report", 3 * s, 3.5 * s, "succeeded"],
      ["Triage", 3.5 * s, 4 * s, "succeeded"],
      ["Publish", 4 * s, 4.5 * s, "succeeded"],
    ];
    const timeline: TimelineRecord[] = [];
    for (const [name, start, end, result] of stages) {
      const state = stageAt(start, end);
      if (!state) continue;
      timeline.push({
        id: name,
        type: "Stage",
        name,
        state,
        result: state === "completed" ? result : null,
      });
    }
    timeline.push({
      id: "phase",
      parentId: "Test",
      type: "Phase",
      name: "Regression",
      state: "inProgress",
    });
    for (let i = 1; i <= 4; i++) {
      const end = s * (1.5 + i * 0.35);
      const state = elapsed < end ? "inProgress" : "completed";
      timeline.push({
        id: `job${i}`,
        parentId: "phase",
        type: "Job",
        name: `Regression ${i}`,
        order: i,
        state,
        result: state === "completed" ? (i === 2 ? "failed" : "succeeded") : null,
      });
    }
    const done = elapsed >= 4.5 * s;
    return {
      run: { state: done ? "completed" : "inProgress", result: done ? "failed" : null },
      timeline,
    };
  }

  async startRun(req: NewRunRequest): Promise<RunSummary> {
    const record = this.record(req);
    this.runs.unshift(record);
    return { ...record, status: "queued" };
  }

  private find(runId: string): DashboardRunRecord {
    const r = this.runs.find((x) => x.id === runId);
    if (!r) throw new NotFoundError(`Unknown run ${runId}`);
    return r;
  }

  async listRuns(): Promise<RunSummary[]> {
    return Promise.all(
      this.runs.map(async (r) => {
        const { run } = this.simulate(r);
        const results = run.state === "completed" ? await this.getResults(r.id) : undefined;
        return {
          ...r,
          status: statusOf(run),
          result: run.result ?? undefined,
          passRate: results?.kpis.passRate,
        };
      }),
    );
  }

  async getProgress(runId: string): Promise<RunProgress> {
    const r = this.find(runId);
    const { run, timeline } = this.simulate(r);
    return {
      run: { ...r, status: statusOf(run), result: run.result ?? undefined },
      ...progressFromTimeline(r, run, timeline),
    };
  }

  async getResults(runId: string): Promise<RunResults | undefined> {
    const r = this.find(runId);
    const { timeline } = this.simulate(r);
    if (!timeline.some((t) => t.name === "Triage" && t.state === "completed")) return undefined;
    return toRunResults(
      sampleReport(r.id, r.releaseVersion, Number(r.id)),
      { build: r.buildUrl, artifacts: `${r.buildUrl}&view=artifacts`, testPlan: r.planUrl },
      (id) => `${MOCK_ORG}/_workitems/edit/${id}`,
    );
  }

  async getTrend(count: number): Promise<TrendPoint[]> {
    const day = 86_400_000;
    return Array.from({ length: count }, (_, i) => {
      const n = count - i;
      const passRate = 0.9 + ((i * 7) % 9) / 100;
      return {
        runId: String(4000 + i),
        label: `2026100${(i % 9) + 1}.1`,
        date: new Date(this.now() - n * day).toISOString(),
        passRate: Number(passRate.toFixed(3)),
        flaky: (i * 3) % 5,
        failed: Math.round((1 - passRate) * 236),
        durationMs: 1_140_000 + ((i * 37) % 11) * 30_000,
      };
    });
  }

  async listReleases(): Promise<Release[]> {
    return groupReleases(await this.listRuns());
  }
}
