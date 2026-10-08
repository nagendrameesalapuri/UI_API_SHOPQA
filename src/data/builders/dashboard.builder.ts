import type {
  RunProgress,
  RunResults,
  RunSummary,
  TrendPoint,
} from "../../../dashboard/shared/contracts";

// Builders for dashboard API payloads (used with page.route in tests/ui/dashboard).
// Same idea as a Java test-data builder: sensible defaults + overrides per test.

export function aRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "4200",
    releaseVersion: "2026.10.1",
    environment: "uat",
    grep: "@Regression",
    planId: 321,
    planUrl: "https://dev.azure.com/org/proj/_testPlans/execute?planId=321",
    pipelineRunId: 4200,
    buildUrl: "https://dev.azure.com/org/proj/_build/results?buildId=4200",
    createdAt: "2026-10-07T08:30:00.000Z",
    status: "queued",
    ...overrides,
  };
}

const STEP_LABELS: Record<RunProgress["steps"][number]["id"], string> = {
  plan: "Test Plan created",
  queued: "Pipeline queued",
  running: "Running tests",
  reports: "Reports merged",
  triage: "Failures triaged",
  published: "Results published to Test Plan",
};

/** Progress where the first `doneSteps` steps are done and the next one is running. */
export function aProgress(doneSteps: number, run: Partial<RunSummary> = {}): RunProgress {
  const ids = Object.keys(STEP_LABELS) as (keyof typeof STEP_LABELS)[];
  const done = doneSteps >= ids.length;
  return {
    run: aRun({ status: done ? "completed" : "running", ...run }),
    steps: ids.map((id, i) => ({
      id,
      label: STEP_LABELS[id],
      state: i < doneSteps ? "done" : i === doneSteps ? "running" : "pending",
    })),
    shards: [1, 2].map((n) => ({
      name: `Regression ${n}`,
      state: doneSteps > 2 ? "done" : "running",
    })),
    done,
  };
}

export function aResults(overrides: Partial<RunResults> = {}): RunResults {
  return {
    runId: "4200",
    releaseVersion: "2026.10.1",
    kpis: {
      total: 120,
      passed: 114,
      failed: 4,
      flaky: 1,
      skipped: 1,
      passRate: 0.958,
      durationMs: 1_320_000,
    },
    totals: { PRODUCT_BUG: 1, ENVIRONMENT: 2, TEST_ISSUE: 1, FLAKY: 1, UNKNOWN: 0 },
    clusters: [
      {
        signatureHash: "aaaa1111",
        category: "ENVIRONMENT",
        kind: "backend",
        confidence: 0.85,
        reason: "Backend answered with a 5xx.",
        count: 2,
        sampleError: "Error: Place order failed. Status: 503",
        isNew: true,
      },
      {
        signatureHash: "bbbb2222",
        category: "PRODUCT_BUG",
        kind: "assertion",
        confidence: 0.8,
        reason: "Wrong total.",
        count: 1,
        sampleError: 'Expected: "₹1,490" Received: "₹1,990"',
        isNew: false,
        bugId: 9001,
        bugUrl: "https://dev.azure.com/org/proj/_workitems/edit/9001",
      },
      {
        signatureHash: "cccc3333",
        category: "TEST_ISSUE",
        kind: "locator",
        confidence: 0.75,
        reason: "Stale locator.",
        count: 1,
        sampleError: "TimeoutError: locator.click: Timeout 10000ms exceeded.",
        isNew: true,
      },
      {
        signatureHash: "dddd4444",
        category: "FLAKY",
        kind: "retry",
        confidence: 0.9,
        reason: "Passed on retry.",
        count: 1,
        sampleError: "Error: expect(received).toEqual(expected)",
        isNew: true,
      },
    ],
    failures: [
      {
        title: "Checkout > Pay by card",
        file: "ui/regression/CheckoutTests.spec.ts",
        project: "chromium",
        category: "ENVIRONMENT",
        kind: "backend",
        confidence: 0.85,
        reason: "Backend answered with a 5xx.",
        errorSummary: "Error: Place order failed. Status: 503",
        signatureHash: "aaaa1111",
        isNew: true,
        tcId: 5101,
        testCaseUrl: "https://dev.azure.com/org/proj/_workitems/edit/5101",
      },
      {
        title: "Orders > Cancel order",
        file: "api/orders/orders.spec.ts",
        project: "api",
        category: "ENVIRONMENT",
        kind: "backend",
        confidence: 0.85,
        reason: "Backend answered with a 5xx.",
        errorSummary: "Error: Place order failed. Status: 503",
        signatureHash: "aaaa1111",
        isNew: true,
      },
      {
        title: "Coupons > FLAT500",
        file: "ui/regression/CouponTests.spec.ts",
        project: "chromium",
        category: "PRODUCT_BUG",
        kind: "assertion",
        confidence: 0.8,
        reason: "Wrong total.",
        errorSummary: 'Expected: "₹1,490" Received: "₹1,990"',
        signatureHash: "bbbb2222",
        isNew: false,
      },
      {
        title: "Wishlist > Move to cart",
        file: "ui/regression/ProfileWishlistTests.spec.ts",
        project: "firefox",
        category: "TEST_ISSUE",
        kind: "locator",
        confidence: 0.75,
        reason: "Stale locator.",
        errorSummary: "TimeoutError: locator.click: Timeout 10000ms exceeded.",
        signatureHash: "cccc3333",
        isNew: true,
      },
      {
        title: "Catalog > Sort by rating",
        file: "ui/regression/ProductCatalogTests.spec.ts",
        project: "chromium",
        category: "FLAKY",
        kind: "retry",
        confidence: 0.9,
        reason: "Passed on retry.",
        errorSummary: "Error: expect(received).toEqual(expected)",
        signatureHash: "dddd4444",
        isNew: true,
      },
    ],
    links: {
      build: "https://dev.azure.com/org/proj/_build/results?buildId=4200",
      artifacts: "https://dev.azure.com/org/proj/_build/results?buildId=4200&view=artifacts",
    },
    ...overrides,
  };
}

export function aTrend(count: number): TrendPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    runId: String(4100 + i),
    label: `20261001.${i + 1}`,
    date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
    passRate: 0.9 + i / 100,
    flaky: i % 3,
    failed: 10 - i,
    durationMs: 1_200_000,
  }));
}
