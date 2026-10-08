import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "../../integrations/store/store";
import { MockAdo } from "../../integrations/test-utils/mock-fetch";
import { runProgressSchema, runResultsSchema } from "../shared/contracts";
import { AdoDashboardService } from "./ado-service";
import { createApp, type AppOptions } from "./app";
import { MockDashboardService } from "./mock-service";
import { progressFromTimeline, type DashboardRunRecord } from "./service";

beforeAll(() => {
  process.env.AGENT_AUDIT_FILE = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "audit-")),
    "a.jsonl",
  );
});

const servers: { close: () => void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start(opts: Partial<AppOptions> = {}) {
  const app = createApp({ service: new MockDashboardService(1), mock: true, ...opts });
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (p: string, init?: RequestInit) =>
    fetch(base + p, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
}

const record: DashboardRunRecord = {
  id: "9",
  releaseVersion: "2026.10",
  environment: "qa",
  grep: "@Regression",
  planId: 1,
  pipelineRunId: 9,
  createdAt: "2026-10-01T00:00:00Z",
};

describe("progressFromTimeline", () => {
  it("maps stages and shard jobs to steps", () => {
    const p = progressFromTimeline(record, { state: "inProgress" }, [
      { id: "s1", type: "Stage", name: "Test", state: "completed", result: "failed" },
      { id: "ph", parentId: "s1", type: "Phase", name: "Regression" },
      {
        id: "j1",
        parentId: "ph",
        type: "Job",
        name: "Regression 1",
        state: "completed",
        result: "succeeded",
        order: 1,
      },
      {
        id: "j2",
        parentId: "ph",
        type: "Job",
        name: "Regression 2",
        state: "inProgress",
        order: 2,
      },
      { id: "s2", type: "Stage", name: "Report", state: "inProgress" },
    ]);
    expect(p.steps.map((s) => s.state)).toEqual([
      "done",
      "done",
      "failed",
      "running",
      "pending",
      "pending",
    ]);
    expect(p.steps[2].detail).toBe("1/2 shards finished (test failures)");
    expect(p.shards).toEqual([
      { name: "Regression 1", state: "done" },
      { name: "Regression 2", state: "running" },
    ]);
    expect(p.done).toBe(false);
  });

  it("marks never-started steps as skipped when the run is finished", () => {
    const p = progressFromTimeline(record, { state: "completed", result: "failed" }, []);
    expect(p.steps.slice(2).every((s) => s.state === "skipped")).toBe(true);
    expect(p.done).toBe(true);
  });
});

describe("dashboard API (mock service)", () => {
  it("runs the full flow: start -> progress -> results", async () => {
    const call = await start({ service: new MockDashboardService(0.01) });
    const res = await call("/api/runs", {
      method: "POST",
      body: JSON.stringify({ releaseVersion: "2026.10.1", environment: "uat" }),
    });
    expect(res.status).toBe(201);
    const run = (await res.json()) as { id: string; grep: string };
    expect(run.grep).toBe("@Regression");
    await new Promise((r) => setTimeout(r, 80));
    const progress = runProgressSchema.parse(
      await (await call(`/api/runs/${run.id}/progress`)).json(),
    );
    expect(progress.done).toBe(true);
    const results = runResultsSchema.parse(
      await (await call(`/api/runs/${run.id}/results`)).json(),
    );
    expect(results.kpis.total).toBeGreaterThan(0);
  });

  it("validates input with field errors", async () => {
    const call = await start();
    const res = await call("/api/runs", {
      method: "POST",
      body: JSON.stringify({ releaseVersion: "x", environment: "prod" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: Record<string, string[]> };
    expect(Object.keys(body.details).sort()).toEqual(["environment", "releaseVersion"]);
  });

  it("returns 404 for unknown runs and API routes", async () => {
    const call = await start();
    expect((await call("/api/runs/nope/progress")).status).toBe(404);
    expect((await call("/api/nothing")).status).toBe(404);
  });

  it("protects the API with basic auth (health stays open)", async () => {
    const call = await start({ auth: { user: "qa", password: "s3cret" } });
    expect((await call("/api/health")).status).toBe(200);
    expect((await call("/api/runs")).status).toBe(401);
    const bad = await call("/api/runs", {
      headers: { Authorization: `Basic ${Buffer.from("qa:wrong").toString("base64")}` },
    });
    expect(bad.status).toBe(401);
    const ok = await call("/api/config", {
      headers: { Authorization: `Basic ${Buffer.from("qa:s3cret").toString("base64")}` },
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { user: string }).user).toBe("qa");
  });
});

describe("AdoDashboardService", () => {
  it("creates/reuses the plan, adds mapped suites, queues the pipeline and remembers the run", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-"));
    const mappingFile = path.join(dir, "tc-mapping.json");
    fs.writeFileSync(
      mappingFile,
      JSON.stringify({
        generatedAt: "x",
        mapped: [
          { tcId: 11, suite: "api/cart", tests: [] },
          { tcId: 12, suite: "ui/regression", tests: [] },
        ],
        unmapped: [],
      }),
    );

    const mock = new MockAdo()
      .on("GET", /testplan\/plans$/, {
        body: { value: [{ id: 50, name: "Regression 2026.10.1" }] },
      })
      .on("GET", /Plans\/50\/suites$/, {
        body: { value: [{ id: 500, name: "root", parentSuite: null }] },
      })
      .on("POST", /Plans\/50\/suites$/, (c) => ({
        body: { id: 501, name: (c.body as { name: string }).name },
      }))
      .on("GET", /TestCase$/, { body: { value: [] } })
      .on("POST", /TestCase$/, { body: [] })
      .on("POST", /pipelines\/7\/runs$/, {
        body: {
          id: 88,
          state: "inProgress",
          createdDate: "2026-10-07T10:00:00Z",
          _links: { web: { href: "https://ado/run/88" } },
        },
      })
      .on("GET", /pipelines\/7\/runs\/88$/, { body: { id: 88, state: "inProgress" } })
      .on("GET", /builds\/88\/timeline$/, {
        body: { records: [{ id: "t", type: "Stage", name: "Test", state: "inProgress" }] },
      });

    const service = new AdoDashboardService(mock.client(), new MemoryStore(), {
      pipelineId: 7,
      branch: "main",
      mappingFile,
    });
    const run = await service.startRun({
      releaseVersion: "2026.10.1",
      environment: "uat",
      grep: "@Regression",
      suites: ["api/cart"],
    });

    expect(run).toMatchObject({
      id: "88",
      planId: 50,
      buildUrl: "https://ado/run/88",
      status: "queued",
    });
    // Only the requested suite is created
    expect(mock.callsTo("POST", /suites$/).map((c) => (c.body as { name: string }).name)).toEqual([
      "api/cart",
    ]);
    expect(mock.callsTo("POST", /pipelines\/7\/runs$/)[0].body).toMatchObject({
      templateParameters: {
        releaseVersion: "2026.10.1",
        testPlanId: "50",
        environment: "uat",
        grep: "@Regression",
      },
    });

    const progress = await service.getProgress("88");
    expect(progress?.steps.find((s) => s.id === "running")?.state).toBe("running");
    expect((await service.listReleases())[0]).toMatchObject({
      releaseVersion: "2026.10.1",
      planId: 50,
    });
  });
});
