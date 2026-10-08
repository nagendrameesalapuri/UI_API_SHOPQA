import { describe, expect, it } from "vitest";
import { MockAdo } from "../test-utils/mock-fetch";
import {
  createBugDraft,
  createTestCase,
  findOpenBugsWithSignature,
  getWorkItem,
  relatedIds,
  stepsXml,
  TESTED_BY,
} from "./work-items";

describe("work-items", () => {
  it("getWorkItem expands relations; relatedIds extracts linked ids", async () => {
    const mock = new MockAdo().on("GET", /workitems\/12$/, {
      body: {
        id: 12,
        fields: { "System.Title": "Story" },
        relations: [
          { rel: TESTED_BY, url: "https://dev.azure.com/org/_apis/wit/workItems/301" },
          {
            rel: "System.LinkTypes.Related",
            url: "https://dev.azure.com/org/_apis/wit/workItems/5",
          },
        ],
      },
    });
    const item = await getWorkItem(mock.client(), 12);
    expect(mock.calls[0].query.get("$expand")).toBe("relations");
    expect(relatedIds(item, TESTED_BY)).toEqual([301]);
  });

  it("createBugDraft sends JSON-Patch with ai-triage + needs-review tags and links", async () => {
    let contentType = "";
    const mock = new MockAdo().on("POST", /workitems\/\$Bug$/, (c) => {
      contentType = c.headers["Content-Type"];
      return { body: { id: 900, fields: {} } };
    });
    const bug = await createBugDraft(mock.client(), {
      title: "Order total wrong [sig:abc123]",
      repro: "<p>steps</p>",
      severity: "2 - High",
      tags: ["checkout"],
      links: [{ url: "https://build/1", comment: "trace" }],
      relatedWorkItemIds: [301],
    });
    expect(bug.id).toBe(900);
    expect(contentType).toBe("application/json-patch+json");
    const ops = mock.calls[0].body as { path: string; value: unknown }[];
    expect(ops).toContainEqual({
      op: "add",
      path: "/fields/System.Tags",
      value: "ai-triage; needs-review; checkout",
    });
    expect(ops).toContainEqual({
      op: "add",
      path: "/fields/Microsoft.VSTS.Common.Severity",
      value: "2 - High",
    });
    expect(ops.filter((o) => o.path === "/relations/-")).toHaveLength(2);
    // State is never set: the bug stays in its default state
    expect(ops.some((o) => o.path === "/fields/System.State")).toBe(false);
  });

  it("findOpenBugsWithSignature queries open ai-triage bugs by signature", async () => {
    const mock = new MockAdo().on("POST", /wit\/wiql$/, { body: { workItems: [{ id: 4 }] } });
    await expect(findOpenBugsWithSignature(mock.client(), "abc'123")).resolves.toEqual([4]);
    const q = (mock.calls[0].body as { query: string }).query;
    expect(q).toContain("[sig:abc123]");
    expect(q).toContain("'ai-triage'");
  });

  it("createTestCase writes escaped steps XML and links the story", async () => {
    const mock = new MockAdo().on("POST", /workitems\/\$Test Case$/, {
      body: { id: 301, fields: {} },
    });
    await createTestCase(mock.client(), {
      title: "Apply coupon",
      steps: [{ action: "Add <item>", expected: "Total & tax" }],
      storyId: 12,
    });
    const ops = mock.calls[0].body as { path: string; value: unknown }[];
    expect(ops.find((o) => o.path === "/fields/Microsoft.VSTS.TCM.Steps")?.value).toContain(
      "Add &lt;item&gt;",
    );
    expect(ops.find((o) => o.path === "/relations/-")?.value).toMatchObject({
      rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
    });
  });

  it("stepsXml numbers steps from 2", () => {
    expect(stepsXml([{ action: "a" }])).toMatch(
      /^<steps id="0" last="2"><step id="2" type="ActionStep">/,
    );
  });
});
