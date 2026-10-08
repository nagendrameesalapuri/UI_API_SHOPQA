import { describe, expect, it } from "vitest";
import {
  buildMapping,
  featureSuiteFor,
  findUnautomated,
  suitesFromMapping,
} from "../ado/test-mapping";
import { parseReport } from "./playwright-json-parser";

const result = (status: string, extra: Record<string, unknown> = {}) => ({
  status,
  duration: 100,
  retry: 0,
  errors: [],
  steps: [],
  attachments: [],
  ...extra,
});

const sample = {
  suites: [
    {
      title: "api/cart/cart.spec.ts",
      file: "api/cart/cart.spec.ts",
      specs: [
        {
          title: "@Regression @TC-101 add item",
          tags: ["Regression", "TC-101"],
          line: 5,
          tests: [
            {
              projectName: "api",
              status: "expected",
              annotations: [],
              results: [result("passed")],
            },
          ],
        },
      ],
      suites: [
        {
          title: "Checkout",
          specs: [
            {
              title: "pays by card",
              tags: [],
              tests: [
                {
                  projectName: "chromium",
                  status: "unexpected",
                  annotations: [{ type: "TC", description: "202" }],
                  results: [
                    result("failed", {
                      error: { message: "\u001b[31mExpected: 5\u001b[39m", stack: "Error at x" },
                      steps: [
                        {
                          title: "Pay",
                          error: { message: "e" },
                          steps: [{ title: "Click pay", error: { message: "e" } }],
                        },
                      ],
                      attachments: [
                        { name: "screenshot", path: "/tmp/s.png", contentType: "image/png" },
                      ],
                    }),
                    result("timedOut"),
                  ],
                },
                {
                  projectName: "firefox",
                  status: "flaky",
                  annotations: [],
                  results: [result("failed", { error: { message: "x" } }), result("passed")],
                },
              ],
            },
            {
              title: "skipped one",
              tags: [],
              tests: [
                {
                  projectName: "api",
                  status: "skipped",
                  annotations: [],
                  results: [result("skipped")],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  errors: [],
  stats: { duration: 1234, expected: 1, unexpected: 1, flaky: 1, skipped: 1 },
};

describe("parseReport", () => {
  const parsed = parseReport(sample, { "api/cart/cart.spec.ts > Checkout > pays by card": 999 });

  it("flattens specs x projects with title paths, tags and statuses", () => {
    expect(parsed.tests.map((t) => [t.titlePath.join(" > "), t.project, t.status])).toEqual([
      ["@Regression @TC-101 add item", "api", "passed"],
      ["Checkout > pays by card", "chromium", "timedOut"],
      ["Checkout > pays by card", "firefox", "flaky"],
      ["Checkout > skipped one", "api", "skipped"],
    ]);
    expect(parsed.tests[0].tags).toEqual(["@Regression", "@TC-101"]);
  });

  it("finds the Test Case id from tag, then annotation, then overrides", () => {
    expect(parsed.tests.map((t) => t.tcId)).toEqual([101, 202, 999, undefined]);
  });

  it("extracts error (ANSI stripped), deepest failing step, retries, attachments, duration", () => {
    const t = parsed.tests[1];
    expect(t.errorMessage).toBe("Expected: 5");
    expect(t.failingStep).toBe("Click pay");
    expect(t.retries).toBe(1);
    expect(t.attachments[0].path).toBe("/tmp/s.png");
    expect(t.duration).toBe(200);
  });

  it("computes failures and stats", () => {
    expect(parsed.failures).toHaveLength(2);
    expect(parsed.stats).toMatchObject({
      total: 4,
      passed: 1,
      failed: 1,
      flaky: 1,
      skipped: 1,
      durationMs: 1234,
    });
  });
});

describe("test-mapping", () => {
  const parsed = parseReport(sample);
  const mapping = buildMapping(parsed, new Date("2026-01-01T00:00:00Z"));

  it("groups tests by Test Case and lists unmapped ones", () => {
    expect(mapping.mapped).toEqual([
      {
        tcId: 101,
        suite: "api/cart",
        tests: [
          {
            file: "api/cart/cart.spec.ts",
            title: "@Regression @TC-101 add item",
            projects: ["api"],
          },
        ],
      },
      {
        tcId: 202,
        suite: "api/cart",
        tests: [
          {
            file: "api/cart/cart.spec.ts",
            title: "Checkout > pays by card",
            projects: ["chromium"],
          },
        ],
      },
    ]);
    expect(mapping.unmapped.map((u) => u.title)).toEqual([
      "Checkout > pays by card",
      "Checkout > skipped one",
    ]);
  });

  it("derives one static suite per feature folder", () => {
    expect(featureSuiteFor("tests/ui/regression/CartTests.spec.ts")).toBe("ui/regression");
    expect(suitesFromMapping(mapping)).toEqual({
      specs: [{ name: "api/cart", type: "static" }],
      testCases: { "api/cart": [101, 202] },
    });
  });

  it("finds Test Cases in the plan without automation", () => {
    const points = [101, 303, 303].map((id, i) => ({
      id: i,
      testCaseReference: { id, name: `tc${id}` },
    }));
    expect(findUnautomated(points, mapping)).toEqual([{ id: 303, name: "tc303" }]);
  });
});
