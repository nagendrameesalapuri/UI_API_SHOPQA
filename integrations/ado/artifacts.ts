import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";
import type { AdoClient } from "./ado-client";

// Build/pipeline artifacts: list, download (zip) and read a JSON file from one.
// Used to read previous runs' ai-triage.json (history without a database) and
// results.json for the dashboard.

export const artifactSchema = z
  .object({
    id: z.number().optional(),
    name: z.string(),
    resource: z.object({ downloadUrl: z.string().optional(), type: z.string().optional() }).loose(),
  })
  .loose();
export type Artifact = z.infer<typeof artifactSchema>;

export async function listArtifacts(client: AdoClient, buildId: number): Promise<Artifact[]> {
  const { value } = await client.get(`build/builds/${buildId}/artifacts`, {
    schema: z.object({ value: z.array(artifactSchema) }),
  });
  return value;
}

/** Downloads an artifact and returns its files (path inside the zip -> bytes). */
export async function downloadArtifact(
  client: AdoClient,
  buildId: number,
  name: string,
): Promise<Record<string, Uint8Array>> {
  const artifact = await client.get(`build/builds/${buildId}/artifacts`, {
    schema: artifactSchema,
    query: { artifactName: name },
  });
  const url = artifact.resource.downloadUrl;
  if (!url) throw new Error(`Artifact ${name} of build ${buildId} has no download URL`);
  const zipUrl = url.includes("format=") ? url : `${url}${url.includes("?") ? "&" : "?"}format=zip`;
  return unzipSync(await client.download(zipUrl));
}

/**
 * Reads one JSON file (matched by file name at any depth) from an artifact.
 * Returns undefined when the artifact or file does not exist.
 */
export async function readArtifactJson<T>(
  client: AdoClient,
  buildId: number,
  artifactName: string,
  fileName: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const artifacts = await listArtifacts(client, buildId);
  if (!artifacts.some((a) => a.name === artifactName)) return undefined;
  const files = await downloadArtifact(client, buildId, artifactName);
  const entry = Object.entries(files).find(([p]) => p === fileName || p.endsWith(`/${fileName}`));
  if (!entry) return undefined;
  return schema.parse(JSON.parse(strFromU8(entry[1])));
}
