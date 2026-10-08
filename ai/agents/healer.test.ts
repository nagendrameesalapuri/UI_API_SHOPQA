import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { MockAdo } from "../../integrations/test-utils/mock-fetch";
import type { LlmProvider } from "../core/llm-provider";
import { runHealer } from "./healer.agent";
import {
  applyLocatorChange,
  extractBrokenLocator,
  findLocatorInSources,
  isAllowedLocator,
  parseAriaSnapshot,
  ruleCandidates,
  strictModeSuggestions,
} from "./healer/locator-tools";
import type { TriageItem, TriageReport } from "./triage-schema";

beforeAll(() => {
  process.env.AGENT_AUDIT_FILE = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "audit-")),
    "a.jsonl",
  );
});

const SNAPSHOT =
  '# Page snapshot\n\n```yaml\n- main:\n  - heading "Your cart" [level=1]\n  - button "Proceed to checkout" [ref=e2]\n  - textbox "Coupon code"\n  - button "Apply"\n```\n';
const NOT_FOUND =
  "TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByTestId('btn-checkout')\n";

const PAGE_OBJECT = `import { Locator, Page } from "@playwright/test";

export class CartPage {
  private checkoutButton: Locator;
  private total: Locator;

  constructor(private page: Page) {
    this.checkoutButton = page.getByTestId("btn-checkout");
    this.total = page.getByTestId("cart-total");
  }
}
`;

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heal-"));
  fs.mkdirSync(path.join(root, "pages"));
  fs.writeFileSync(path.join(root, "pages", "CartPage.ts"), PAGE_OBJECT);
  const ctx = path.join(root, "error-context.md");
  fs.writeFileSync(ctx, SNAPSHOT);
  return { root, ctx };
}

const item = (ctx: string, over: Partial<TriageItem> = {}): TriageItem => ({
  testId: "ui/regression/CartTests.spec.ts::Cart > checkout::chromium",
  title: "Cart > checkout",
  file: "ui/regression/CartTests.spec.ts",
  project: "chromium",
  tags: [],
  status: "failed",
  retries: 0,
  errorSummary: "TimeoutError: locator.click: Timeout 10000ms exceeded.",
  errorMessage: NOT_FOUND,
  attachments: [{ name: "error-context", path: ctx }],
  duration: 1,
  category: "TEST_ISSUE",
  kind: "locator",
  confidence: 0.75,
  reason: "",
  ruleId: "locator-not-found",
  source: "rules",
  signature: "s",
  signatureHash: "abcd1234",
  isNew: true,
  history: { runs: 0, failures: 0, consecutiveFailures: 0 },
  ...over,
});

const report = (items: TriageItem[]): TriageReport => ({
  schemaVersion: 1,
  generatedAt: "2026-10-07T00:00:00Z",
  run: { runId: "512" },
  llm: { provider: "none", model: "none", calls: 0, costUsd: 0 },
  stats: { total: 1, passed: 0, failed: 1, flaky: 0, skipped: 0, durationMs: 0, passRate: 0 },
  totals: { PRODUCT_BUG: 0, ENVIRONMENT: 0, TEST_ISSUE: 1, FLAKY: 0, UNKNOWN: 0 },
  items,
  clusters: [],
  globalErrors: [],
  runRecord: { runId: "512", date: "x", results: {} },
});

describe("locator tools", () => {
  it("extracts the broken locator from not-found and strict-mode errors", () => {
    expect(extractBrokenLocator(NOT_FOUND)).toBe("getByTestId('btn-checkout')");
    const strict =
      "Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Add' }) resolved to 2 elements:\n    1) <button> aka getByTestId('add-main')\n    2) <button> aka getByRole('button', { name: 'Add' }).nth(1)";
    expect(extractBrokenLocator(strict)).toBe("getByRole('button', { name: 'Add' })");
    expect(strictModeSuggestions(strict)).toEqual(["getByTestId('add-main')"]);
  });

  it("parses the aria snapshot", () => {
    expect(parseAriaSnapshot(SNAPSHOT)).toContainEqual({
      role: "button",
      name: "Proceed to checkout",
      depth: 1,
    });
  });

  it("proposes a unique getByRole from the test id's words and role hint", () => {
    const c = ruleCandidates("getByTestId('btn-checkout')", parseAriaSnapshot(SNAPSHOT));
    expect(c[0].expression).toBe('getByRole("button", { name: "Proceed to checkout" })');
  });

  it("finds the page-object line regardless of quote style", () => {
    const { root } = project();
    const hits = findLocatorInSources("getByTestId('btn-checkout')", [path.join(root, "pages")]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      line: 7,
      field: "checkoutButton",
      expression: 'page.getByTestId("btn-checkout")',
    });
  });

  it("refuses XPath/CSS, multi-statement code and lines with assertions", () => {
    expect(isAllowedLocator('page.getByRole("button", { name: "Pay" })')).toBe(true);
    expect(isAllowedLocator('page.locator("//div")')).toBe(false);
    expect(isAllowedLocator('page.getByText("x"); process.exit(1)')).toBe(false);
    const hit = { file: "f", line: 0, text: "", expression: 'page.getByTestId("x")' };
    expect(() =>
      applyLocatorChange(
        'await expect(page.getByTestId("x")).toBeVisible();',
        hit,
        'getByText("y")',
      ),
    ).toThrowError(/assertion/);
  });
});

describe("runHealer", () => {
  it("heals a page-object locator when the re-run passes, and opens a draft PR with only that file", async () => {
    const { root, ctx } = project();
    const reruns: string[] = [];
    const mock = new MockAdo()
      .on("GET", /refs$/, (c) =>
        c.query.get("filter") === "heads/main"
          ? { body: { value: [{ name: "refs/heads/main", objectId: "base" }] } }
          : { body: { value: [] } },
      )
      .on("GET", /items$/, { body: {} })
      .on("POST", /pushes$/, { body: {} })
      .on("GET", /pullrequests$/, { body: { value: [] } })
      .on("POST", /pullrequests$/, {
        body: { pullRequestId: 3, repository: { webUrl: "https://repo" } },
      });

    const result = await runHealer(
      report([item(ctx)]),
      {},
      {
        rootDir: root,
        ado: mock.client(),
        repo: "shop",
        rerun: (i) => {
          reruns.push(i.testId);
          return fs
            .readFileSync(path.join(root, "pages", "CartPage.ts"), "utf8")
            .includes("Proceed to checkout");
        },
      },
    );

    expect(result.outcomes[0]).toMatchObject({ status: "healed" });
    expect(reruns).toHaveLength(1);
    const src = fs.readFileSync(path.join(root, "pages", "CartPage.ts"), "utf8");
    expect(src).toContain(
      'this.checkoutButton = page.getByRole("button", { name: "Proceed to checkout" });',
    );
    expect(src).toContain('page.getByTestId("cart-total")'); // untouched
    const push = mock.callsTo("POST", /pushes$/)[0].body as {
      commits: { changes: { item: { path: string } }[] }[];
    };
    expect(push.commits[0].changes.map((c) => c.item.path)).toEqual(["/pages/CartPage.ts"]);
    expect(mock.callsTo("POST", /pullrequests$/)[0].body).toMatchObject({
      isDraft: true,
      labels: [{ name: "ai-generated" }, { name: "ai-healer" }],
    });
    expect(result.pullRequestUrl).toBe("https://repo/pullrequest/3");
  });

  it("reverts and reports not-healed when no candidate passes (max 2 attempts, incl. LLM)", async () => {
    const { root, ctx } = project();
    let reruns = 0;
    const llm: LlmProvider = {
      name: "anthropic",
      model: "fake",
      complete: async () => "",
      usage: () => ({ calls: 1, spentUsd: 0 }),
      json: async <T>(schema: z.ZodType<T>) =>
        schema.parse({
          locator: 'page.getByRole("button", { name: "Checkout" })',
          confidence: 0.9,
          reason: "renamed",
        }),
    };
    const result = await runHealer(
      report([item(ctx)]),
      {},
      { rootDir: root, llm, rerun: () => (reruns++, false) },
    );
    expect(result.outcomes[0].status).toBe("not-healed");
    expect(result.outcomes[0].attempts.map((a) => a.source)).toEqual(["llm", "rules"]);
    expect(reruns).toBe(2);
    expect(fs.readFileSync(path.join(root, "pages", "CartPage.ts"), "utf8")).toBe(PAGE_OBJECT);
  });

  it("dry run validates but leaves the working tree untouched", async () => {
    const { root, ctx } = project();
    const result = await runHealer(
      report([item(ctx)]),
      { dryRun: true },
      { rootDir: root, rerun: () => true },
    );
    expect(result.diff).toContain(
      '+    this.checkoutButton = page.getByRole("button", { name: "Proceed to checkout" });',
    );
    expect(fs.readFileSync(path.join(root, "pages", "CartPage.ts"), "utf8")).toBe(PAGE_OBJECT);
  });

  it("skips non-locator failures and locators that live in specs", async () => {
    const { root, ctx } = project();
    const result = await runHealer(
      report([
        item(ctx, { category: "PRODUCT_BUG", kind: "assertion" }),
        item(ctx, { errorMessage: "TimeoutError\n  - waiting for getByTestId('only-in-spec')\n" }),
      ]),
      {},
      { rootDir: root, rerun: () => true },
    );
    expect(result.outcomes.map((o) => o.status)).toEqual(["skipped"]);
    expect(result.outcomes[0].reason).toMatch(/not defined in a page object/);
  });
});
