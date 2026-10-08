import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { MockAdo } from "../../integrations/test-utils/mock-fetch";
import type { LlmProvider } from "../core/llm-provider";
import { htmlToText, parseAcceptanceCriteria } from "./story/acceptance-parser";
import { suggestMethods, type PageMethod } from "./story/page-index";
import { runStoryToTest } from "./story-to-test.agent";

const STORY_FILE = path.resolve(__dirname, "..", "evals", "fixtures", "story-1234.json");
const story = JSON.parse(fs.readFileSync(STORY_FILE, "utf8"));

const index: PageMethod[] = [
  {
    page: "CartPage",
    fixture: "cartPage",
    method: "applyCoupon",
    signature: "applyCoupon(code: string)",
    words: ["cart", "apply", "coupon"],
    methodWords: ["apply", "coupon"],
  },
  {
    page: "AdminCouponsPage",
    fixture: "adminCouponsPage",
    method: "createCoupon",
    signature: "createCoupon(c)",
    words: ["admin", "coupons", "create", "coupon"],
    methodWords: ["create", "coupon"],
  },
];

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-"));
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tests", "seed.spec.ts"), "// seed");
  fs.mkdirSync(path.join(dir, "fixtures"));
  fs.writeFileSync(
    path.join(dir, "fixtures", "ui.fixture.ts"),
    "type UIFixtures = {\n  cartPage: CartPage;\n};",
  );
  return dir;
}

beforeAll(() => {
  process.env.AGENT_AUDIT_FILE = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "audit-")),
    "a.jsonl",
  );
});

describe("acceptance criteria parser", () => {
  it("parses Gherkin scenarios from ADO HTML", () => {
    const scenarios = parseAcceptanceCriteria(
      story.fields["Microsoft.VSTS.Common.AcceptanceCriteria"],
    );
    expect(scenarios.map((s) => [s.title, s.type])).toEqual([
      ["Valid coupon reduces the total", "positive"],
      ["Expired coupon is rejected", "negative"],
      ["Minimum order value", "negative"],
    ]);
    expect(scenarios[0]).toMatchObject({
      given: ["a signed-in customer with items worth more than 2000 in the cart"],
      when: ["they apply the coupon FLAT500"],
      then: ["the cart total is reduced by 500", "the coupon is shown as applied"],
    });
  });

  it("splits Gherkin without 'Scenario:' on each new Given", () => {
    const s = parseAcceptanceCriteria(
      "Given A\nWhen B\nThen C\nGiven D\nWhen E\nThen the API returns status code 400",
    );
    expect(s).toHaveLength(2);
    expect(s[1]).toMatchObject({ level: "api", title: "the API returns status code 400" });
  });

  it("turns bullet and numbered lists into one scenario per item, with TODOs", () => {
    const s = parseAcceptanceCriteria(
      "<ul><li>User can remove an item</li><li>Empty cart shows a message</li></ul>",
    );
    expect(s.map((x) => x.title)).toEqual([
      "User can remove an item",
      "Empty cart shows a message",
    ]);
    expect(s[0].given[0]).toMatch(/^TODO/);
    expect(parseAcceptanceCriteria("1. First rule\n2) Second rule")).toHaveLength(2);
  });

  it("flattens HTML entities and tags", () => {
    expect(htmlToText("<div>a &amp; b</div><div>c&nbsp;d</div>")).toBe("a & b\nc d");
  });
});

describe("page-object hints", () => {
  it("prefers storefront methods for customer steps", () => {
    expect(
      suggestMethods("When they apply the coupon FLAT500", index).map((m) => m.method),
    ).toEqual(["applyCoupon"]);
    expect(suggestMethods("Given an admin creates a coupon", index)[0].method).toBe("createCoupon");
  });
});

describe("runStoryToTest", () => {
  it("--dry-run in none mode writes the plan and a compilable fixme skeleton, without ADO writes", async () => {
    const root = tmpRoot();
    const result = await runStoryToTest(
      { storyFile: STORY_FILE, dryRun: true },
      { rootDir: root, pageIndex: index },
    );
    expect(result).toMatchObject({ storyId: 1234, source: "rules", needsHuman: false });
    const spec = fs.readFileSync(path.join(root, "tests/ui/stories/story-1234.spec.ts"), "utf8");
    const plan = fs.readFileSync(path.join(root, "specs/story-1234.md"), "utf8");
    expect(spec).toContain('import { test } from "../../../src/fixtures";');
    expect(spec.match(/test\.fixme\(/g)).toHaveLength(3);
    expect(spec).toContain('await test.step("And the coupon is shown as applied"');
    expect(spec).toContain("cartPage.applyCoupon(code: string)");
    expect(spec).not.toMatch(/page\.(locator|getBy)/); // no raw locators
    expect(plan).toContain("Linked Test Cases: 5001");
    expect(plan).toContain("DRAFT");
  });

  it("creates Test Cases, commits to ai/story-<id> and opens a draft PR linked to the story", async () => {
    const root = tmpRoot();
    let nextTc = 7001;
    const mock = new MockAdo()
      .on("GET", /workitems\/1234$/, { body: story })
      .on("POST", /workitems\/\$Test Case$/, () => ({ body: { id: nextTc++, fields: {} } }))
      .on("GET", /refs$/, (c) =>
        c.query.get("filter") === "heads/main"
          ? { body: { value: [{ name: "refs/heads/main", objectId: "base" }] } }
          : { body: { value: [] } },
      )
      .on("GET", /items$/, { status: 404, body: {} })
      .on("POST", /pushes$/, { body: { commits: [{ commitId: "c1" }] } })
      .on("GET", /pullrequests$/, { body: { value: [] } })
      .on("POST", /pullrequests$/, {
        body: {
          pullRequestId: 77,
          repository: { webUrl: "https://dev.azure.com/org/Proj/_git/shop" },
        },
      });

    const validations: string[] = [];
    const result = await runStoryToTest(
      { workItemId: 1234, createTestCases: true },
      {
        ado: mock.client(),
        repo: "shop",
        rootDir: root,
        pageIndex: index,
        validate: (file) => {
          validations.push(file);
          return { ok: true, output: "typecheck, lint passed" };
        },
      },
    );

    expect(result.createdTestCases).toEqual([7001, 7002, 7003]);
    expect(result.branch).toBe("ai/story-1234");
    expect(result.pullRequestUrl).toBe("https://dev.azure.com/org/Proj/_git/shop/pullrequest/77");
    expect(validations).toEqual(["tests/ui/stories/story-1234.spec.ts"]);

    const push = mock.callsTo("POST", /pushes$/)[0].body as {
      refUpdates: { name: string }[];
      commits: { changes: { item: { path: string }; newContent: { content: string } }[] }[];
    };
    expect(push.refUpdates[0].name).toBe("refs/heads/ai/story-1234");
    const changes = push.commits[0].changes;
    expect(changes.map((c) => c.item.path)).toEqual([
      "/specs/story-1234.md",
      "/tests/ui/stories/story-1234.spec.ts",
    ]);
    expect(changes[1].newContent.content).toContain("@TC-7001");

    const pr = mock.callsTo("POST", /pullrequests$/)[0].body as Record<string, unknown>;
    expect(pr).toMatchObject({
      isDraft: true,
      workItemRefs: [{ id: "1234" }],
      labels: [{ name: "ai-generated" }],
      targetRefName: "refs/heads/main",
    });
    expect(String(pr.description)).toContain("7001, 7002, 7003");
    // Never merges, never edits work-item state
    expect(mock.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("LLM mode: invalid spec is fixed at most twice, then reported as needs-human", async () => {
    const root = tmpRoot();
    let generated = 0;
    const llm: LlmProvider = {
      name: "anthropic",
      model: "fake",
      complete: async () => "",
      usage: () => ({ calls: generated, spentUsd: 0 }),
      json: async <T>(schema: z.ZodType<T>, prompt: string) => {
        generated++;
        if (prompt.includes('"scenarios": [{')) {
          return schema.parse({
            scenarios: [{ title: "LLM scenario", given: ["g"], when: ["w"], then: ["t"] }],
          });
        }
        return schema.parse({
          fileName: "story-1234.spec.ts",
          code: `// attempt ${generated}\nimport { test } from "../../../src/fixtures";`,
        });
      },
    };
    let validations = 0;
    const result = await runStoryToTest(
      { storyFile: STORY_FILE, dryRun: true },
      {
        llm,
        rootDir: root,
        pageIndex: index,
        validate: () => ({ ok: false, step: "typecheck", output: `error ${++validations}` }),
      },
    );
    expect(result.source).toBe("llm");
    expect(result.scenarios[0].title).toBe("LLM scenario");
    expect(validations).toBe(3); // first try + 2 fixes
    expect(result.needsHuman).toBe(true);
  });
});
