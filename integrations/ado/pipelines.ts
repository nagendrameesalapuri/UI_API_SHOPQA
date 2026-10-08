import { z } from "zod";
import type { AdoClient } from "./ado-client";

// Pipelines: queue a run with template parameters, poll it, read its timeline.
// Artifact helpers live in artifacts.ts and are re-exported here.

export const runSchema = z
  .object({
    id: z.number(),
    name: z.string().optional(),
    state: z.enum(["unknown", "inProgress", "canceling", "completed"]).or(z.string()),
    result: z.string().nullish(),
    createdDate: z.string().optional(),
    finishedDate: z.string().nullish(),
    templateParameters: z.record(z.string(), z.unknown()).nullish(),
    _links: z
      .object({ web: z.object({ href: z.string() }).loose().optional() })
      .loose()
      .optional(),
  })
  .loose();
export type PipelineRun = z.infer<typeof runSchema>;

export async function queueRun(
  client: AdoClient,
  pipelineId: number,
  templateParameters: Record<string, string | number | boolean>,
  branch = "refs/heads/main",
): Promise<PipelineRun> {
  const refName = branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
  return client.post(`pipelines/${pipelineId}/runs`, {
    schema: runSchema,
    body: {
      resources: { repositories: { self: { refName } } },
      // Pipeline parameters are strings on the wire
      templateParameters: Object.fromEntries(
        Object.entries(templateParameters).map(([k, v]) => [k, String(v)]),
      ),
    },
  });
}

export async function getRun(
  client: AdoClient,
  pipelineId: number,
  runId: number,
): Promise<PipelineRun> {
  return client.get(`pipelines/${pipelineId}/runs/${runId}`, { schema: runSchema });
}

/** Most recent runs first. */
export async function listRuns(
  client: AdoClient,
  pipelineId: number,
  top = 20,
): Promise<PipelineRun[]> {
  const { value } = await client.get(`pipelines/${pipelineId}/runs`, {
    schema: z.object({ value: z.array(runSchema) }),
  });
  return value.sort((a, b) => b.id - a.id).slice(0, top);
}

export const timelineRecordSchema = z
  .object({
    id: z.string(),
    parentId: z.string().nullish(),
    type: z.string(),
    name: z.string(),
    state: z.string().nullish(),
    result: z.string().nullish(),
    order: z.number().nullish(),
    startTime: z.string().nullish(),
    finishTime: z.string().nullish(),
  })
  .loose();
export type TimelineRecord = z.infer<typeof timelineRecordSchema>;

/** Stages / jobs / tasks of a build, used for the dashboard's live progress. */
export async function getTimeline(client: AdoClient, buildId: number): Promise<TimelineRecord[]> {
  const res = await client.get(`build/builds/${buildId}/timeline`, {
    schema: z
      .object({ records: z.array(timelineRecordSchema) })
      .loose()
      .nullable(),
  });
  return res?.records ?? [];
}

export { listArtifacts, downloadArtifact, readArtifactJson } from "./artifacts";
