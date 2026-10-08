import { describe, expect, it } from "vitest";
import { MockAdo } from "../test-utils/mock-fetch";
import {
  addTestCases,
  createReleasePlan,
  ensureSuites,
  getAllTestPoints,
  testCasesTaggedWiql,
} from "./test-plans";

describe("test-plans", () => {
  it("reuses an existing plan with the same name (idempotent)", async () => {
    const mock = new MockAdo().on("GET", /testplan\/plans$/, {
      body: { value: [{ id: 7, name: "Regression 2026.10" }] },
    });
    const { plan, created } = await createReleasePlan(mock.client(), { releaseVersion: "2026.10" });
    expect(plan.id).toBe(7);
    expect(created).toBe(false);
    expect(mock.callsTo("POST", /plans$/)).toHaveLength(0);
  });

  it("creates the plan when missing", async () => {
    const mock = new MockAdo()
      .on("GET", /testplan\/plans$/, { body: { value: [] } })
      .on("POST", /testplan\/plans$/, {
        body: { id: 9, name: "Regression 2026.11", rootSuite: { id: 10 } },
      });
    const { plan, created } = await createReleasePlan(mock.client(), {
      releaseVersion: "2026.11",
      areaPath: "Proj\\QA",
    });
    expect(created).toBe(true);
    expect(plan.id).toBe(9);
    expect(mock.callsTo("POST", /plans$/)[0].body).toMatchObject({
      name: "Regression 2026.11",
      areaPath: "Proj\\QA",
    });
  });

  it("ensureSuites creates only missing suites under the root, static or query-based", async () => {
    const mock = new MockAdo()
      .on("GET", /Plans\/9\/suites$/, {
        body: {
          value: [
            { id: 10, name: "Regression", parentSuite: null },
            { id: 11, name: "api/cart", parentSuite: { id: 10 } },
          ],
        },
      })
      .on("POST", /Plans\/9\/suites$/, (c) => ({
        body: { id: 20, name: (c.body as { name: string }).name },
      }));
    const ids = await ensureSuites(mock.client(), 9, [
      { name: "api/cart", type: "static" },
      { name: "ui/regression", type: "static" },
      { name: "tagged smoke", type: "query", wiql: testCasesTaggedWiql("smoke") },
    ]);
    expect(ids).toEqual({ "api/cart": 11, "ui/regression": 20, "tagged smoke": 20 });
    const posts = mock.callsTo("POST", /suites$/).map((c) => c.body);
    expect(posts[0]).toEqual({
      suiteType: "staticTestSuite",
      name: "ui/regression",
      parentSuite: { id: 10 },
    });
    expect(posts[1]).toMatchObject({
      suiteType: "dynamicTestSuite",
      queryString: expect.stringContaining("'smoke'"),
    });
  });

  it("addTestCases skips Test Cases already in the suite", async () => {
    const mock = new MockAdo()
      .on("GET", /TestCase$/, { body: { value: [{ workItem: { id: 1 } }] } })
      .on("POST", /TestCase$/, { body: [] });
    const added = await addTestCases(mock.client(), 9, 11, [1, 2, 2, 3]);
    expect(added).toEqual([2, 3]);
    expect(mock.callsTo("POST", /TestCase$/)[0].body).toEqual([
      { workItem: { id: 2 } },
      { workItem: { id: 3 } },
    ]);
  });

  it("getAllTestPoints collects points from every suite", async () => {
    const mock = new MockAdo()
      .on("GET", /Plans\/9\/suites$/, {
        body: {
          value: [
            { id: 10, name: "root" },
            { id: 11, name: "a", parentSuite: { id: 10 } },
          ],
        },
      })
      .on("GET", /Suites\/10\/TestPoint$/, { body: { value: [] } })
      .on("GET", /Suites\/11\/TestPoint$/, {
        body: { value: [{ id: 100, testCaseReference: { id: 1 } }] },
      });
    const points = await getAllTestPoints(mock.client(), 9);
    expect(points.map((p) => p.id)).toEqual([100]);
  });
});
