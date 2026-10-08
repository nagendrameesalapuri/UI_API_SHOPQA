import { describe, expect, it } from "vitest";
import type { NormalizedTest, ParsedReport } from "../report/playwright-json-parser";
import { MockAdo } from "../test-utils/mock-fetch";
import { aggregateByTestCase, publishResultsToPlan } from "./test-results";

const t = (over: Partial<NormalizedTest>): NormalizedTest => ({
  testId: "x",
  title: "t",
  titlePath: ["t"],
  file: "api/cart/cart.spec.ts",
  project: "api",
  tags: [],
  status: "passed",
  retries: 0,
  attachments: [],
  duration: 100,
  ...over,
});

const report = (tests: NormalizedTest[]): ParsedReport => ({
  tests,
  failures: [],
  stats: { total: tests.length, passed: 0, failed: 0, flaky: 0, skipped: 0, durationMs: 0 },
  globalErrors: [],
});

describe("aggregateByTestCase", () => {
  it("keeps the worst outcome across projects and marks flaky as passed with a note", () => {
    const map = aggregateByTestCase([
      t({ tcId: 1, project: "chromium", status: "flaky", retries: 1 }),
      t({ tcId: 1, project: "firefox", status: "failed", errorMessage: "boom" }),
      t({ tcId: 2, status: "flaky", retries: 2 }),
      t({ status: "failed" }), // unmapped: ignored
    ]);
    expect(map.get(1)).toMatchObject({
      outcome: "Failed",
      errorMessage: "boom",
      durationInMs: 200,
    });
    expect(map.get(2)).toMatchObject({ outcome: "Passed", comment: "api: flaky after 2 retries" });
    expect(map.size).toBe(2);
  });
});

describe("publishResultsToPlan", () => {
  const plan = () =>
    new MockAdo()
      .on("GET", /Plans\/5\/suites$/, { body: { value: [{ id: 50, name: "root" }] } })
      .on("GET", /Suites\/50\/TestPoint$/, {
        body: {
          value: [
            { id: 501, testCaseReference: { id: 1 } },
            { id: 502, testCaseReference: { id: 2 } },
            { id: 503, testCaseReference: { id: 3 } },
          ],
        },
      });

  it("creates a run for mapped points, patches outcomes and completes the run", async () => {
    const mock = plan()
      .on("POST", /test\/runs$/, { body: { id: 77, webAccessUrl: "https://x/run/77" } })
      .on("GET", /Runs\/77\/results$/, {
        body: {
          value: [
            { id: 1001, testPoint: { id: "501" }, testCase: { id: "1" } },
            { id: 1002, testPoint: { id: "502" }, testCase: { id: "2" } },
          ],
        },
      })
      .on("PATCH", /Runs\/77\/results$/, { body: {} })
      .on("PATCH", /runs\/77$/, { body: {} });

    const summary = await publishResultsToPlan(mock.client(), {
      planId: 5,
      buildId: 42,
      report: report([
        t({ tcId: 1 }),
        t({ tcId: 2, status: "timedOut", errorMessage: "slow" }),
        t({ tcId: 99 }),
      ]),
      artifactsUrl: "https://ado/build/42",
    });

    expect(summary).toMatchObject({
      runId: 77,
      published: 2,
      byOutcome: { Passed: 1, Timeout: 1 },
      notInPlan: [99],
    });
    const runBody = mock.callsTo("POST", /test\/runs$/)[0].body;
    expect(runBody).toMatchObject({
      plan: { id: "5" },
      pointIds: [501, 502],
      automated: true,
      build: { id: "42" },
    });
    const patched = mock.callsTo("PATCH", /results$/)[0].body as {
      id: number;
      outcome: string;
      comment: string;
    }[];
    expect(patched.map((p) => [p.id, p.outcome])).toEqual([
      [1001, "Passed"],
      [1002, "Timeout"],
    ]);
    expect(patched[1].comment).toContain("https://ado/build/42");
    expect(mock.callsTo("PATCH", /runs\/77$/)[0].body).toEqual({ state: "Completed" });
  });

  it("completes the run even when patching results fails", async () => {
    const mock = plan()
      .on("POST", /test\/runs$/, { body: { id: 78 } })
      .on("GET", /Runs\/78\/results$/, { body: { value: [{ id: 1, testCase: { id: "1" } }] } })
      .on("PATCH", /Runs\/78\/results$/, { status: 400, body: { message: "bad" } })
      .on("PATCH", /runs\/78$/, { body: {} });
    await expect(
      publishResultsToPlan(mock.client(), { planId: 5, report: report([t({ tcId: 1 })]) }),
    ).rejects.toThrow();
    expect(mock.callsTo("PATCH", /runs\/78$/)).toHaveLength(1);
  });

  it("creates no run when nothing maps to the plan", async () => {
    const mock = plan();
    const summary = await publishResultsToPlan(mock.client(), {
      planId: 5,
      report: report([t({})]),
    });
    expect(summary.published).toBe(0);
    expect(mock.callsTo("POST", /runs$/)).toHaveLength(0);
  });
});
