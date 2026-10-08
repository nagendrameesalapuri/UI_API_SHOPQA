import { z } from "zod";
import type { AdoClient } from "./ado-client";

// Work items: read stories (with relations), create DRAFT bugs and Test Cases.
// Agents never close, delete or change the state of work items.

export const workItemSchema = z
  .object({
    id: z.number(),
    rev: z.number().optional(),
    fields: z.record(z.string(), z.unknown()),
    relations: z
      .array(
        z
          .object({
            rel: z.string(),
            url: z.string(),
            attributes: z.record(z.string(), z.unknown()).optional(),
          })
          .loose(),
      )
      .nullish(),
    url: z.string().optional(),
  })
  .loose();
export type WorkItem = z.infer<typeof workItemSchema>;

type PatchOp = { op: "add"; path: string; value: unknown };
const JSON_PATCH = "application/json-patch+json";

export async function getWorkItem(client: AdoClient, id: number): Promise<WorkItem> {
  return client.get(`wit/workitems/${id}`, {
    schema: workItemSchema,
    query: { $expand: "relations" },
  });
}

export async function getWorkItems(client: AdoClient, ids: number[]): Promise<WorkItem[]> {
  if (ids.length === 0) return [];
  const out: WorkItem[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { value } = await client.get("wit/workitems", {
      schema: z.object({ value: z.array(workItemSchema) }),
      query: { ids: ids.slice(i, i + 200).join(","), $expand: "relations" },
    });
    out.push(...value);
  }
  return out;
}

export async function queryWiql(client: AdoClient, query: string): Promise<number[]> {
  const res = await client.post("wit/wiql", {
    schema: z.object({ workItems: z.array(z.object({ id: z.number() }).loose()) }).loose(),
    body: { query },
  });
  return res.workItems.map((w) => w.id);
}

export const workItemApiUrl = (client: AdoClient, id: number) =>
  `${client.orgUrl}/_apis/wit/workItems/${id}`;
export const workItemWebUrl = (client: AdoClient, id: number) =>
  client.webUrl(`_workitems/edit/${id}`);

/** Ids of work items linked with the given relation type (e.g. TestedBy-Forward). */
export function relatedIds(item: WorkItem, rel: string): number[] {
  return (item.relations ?? [])
    .filter((r) => r.rel === rel)
    .map((r) => Number(r.url.split("/").pop()))
    .filter((n) => Number.isFinite(n));
}

export const TESTED_BY = "Microsoft.VSTS.Common.TestedBy-Forward";

// ---- Bugs ----

export type Severity = "1 - Critical" | "2 - High" | "3 - Medium" | "4 - Low";

export type BugDraft = {
  title: string;
  /** HTML allowed */
  repro: string;
  severity?: Severity;
  tags?: string[];
  links?: { url: string; comment?: string }[];
  relatedWorkItemIds?: number[];
  areaPath?: string;
};

export const BUG_TAGS = ["ai-triage", "needs-review"];

/** Creates a Bug with the default state (New). Always tagged ai-triage + needs-review. */
export async function createBugDraft(client: AdoClient, bug: BugDraft): Promise<WorkItem> {
  const tags = [...new Set([...BUG_TAGS, ...(bug.tags ?? [])])].join("; ");
  const ops: PatchOp[] = [
    { op: "add", path: "/fields/System.Title", value: bug.title.slice(0, 255) },
    { op: "add", path: "/fields/Microsoft.VSTS.TCM.ReproSteps", value: bug.repro },
    {
      op: "add",
      path: "/fields/Microsoft.VSTS.Common.Severity",
      value: bug.severity ?? "3 - Medium",
    },
    { op: "add", path: "/fields/System.Tags", value: tags },
  ];
  if (bug.areaPath) ops.push({ op: "add", path: "/fields/System.AreaPath", value: bug.areaPath });
  for (const link of bug.links ?? []) {
    ops.push({
      op: "add",
      path: "/relations/-",
      value: { rel: "Hyperlink", url: link.url, attributes: { comment: link.comment ?? "" } },
    });
  }
  for (const id of bug.relatedWorkItemIds ?? []) {
    ops.push({
      op: "add",
      path: "/relations/-",
      value: { rel: "System.LinkTypes.Related", url: workItemApiUrl(client, id) },
    });
  }
  return client.post("wit/workitems/$Bug", {
    schema: workItemSchema,
    body: ops,
    contentType: JSON_PATCH,
  });
}

/** Open ai-triage bugs whose title carries the failure signature "[sig:<hash>]". */
export async function findOpenBugsWithSignature(
  client: AdoClient,
  signatureHash: string,
): Promise<number[]> {
  const safe = signatureHash.replace(/[^a-z0-9]/gi, "");
  return queryWiql(
    client,
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project " +
      "AND [System.WorkItemType] = 'Bug' " +
      "AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Resolved') " +
      "AND [System.Tags] CONTAINS 'ai-triage' " +
      `AND [System.Title] CONTAINS '[sig:${safe}]'`,
  );
}

// ---- Test Cases ----

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Microsoft.VSTS.TCM.Steps XML for a list of { action, expected } steps. */
export function stepsXml(steps: { action: string; expected?: string }[]): string {
  const body = steps
    .map(
      (s, i) =>
        `<step id="${i + 2}" type="${s.expected ? "ValidateStep" : "ActionStep"}">` +
        `<parameterizedString isformatted="true">${escapeXml(s.action)}</parameterizedString>` +
        `<parameterizedString isformatted="true">${escapeXml(s.expected ?? "")}</parameterizedString>` +
        "<description/></step>",
    )
    .join("");
  return `<steps id="0" last="${steps.length + 1}">${body}</steps>`;
}

export async function createTestCase(
  client: AdoClient,
  tc: {
    title: string;
    steps: { action: string; expected?: string }[];
    storyId?: number;
    tags?: string[];
  },
): Promise<WorkItem> {
  const ops: PatchOp[] = [
    { op: "add", path: "/fields/System.Title", value: tc.title.slice(0, 255) },
    { op: "add", path: "/fields/Microsoft.VSTS.TCM.Steps", value: stepsXml(tc.steps) },
    {
      op: "add",
      path: "/fields/System.Tags",
      value: ["ai-generated", ...(tc.tags ?? [])].join("; "),
    },
  ];
  if (tc.storyId) {
    // The story is "tested by" this Test Case
    ops.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
        url: workItemApiUrl(client, tc.storyId),
      },
    });
  }
  return client.post("wit/workitems/$Test Case", {
    schema: workItemSchema,
    body: ops,
    contentType: JSON_PATCH,
  });
}
