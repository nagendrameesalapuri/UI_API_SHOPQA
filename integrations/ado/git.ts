import { z } from "zod";
import { AdoError, type AdoClient } from "./ado-client";

// Azure Repos via REST: create a branch with a commit and open a pull request.
// Agents only ever create branches and PRs: no merge, no delete, no force-push.

const refSchema = z.object({ name: z.string(), objectId: z.string() }).loose();
const prSchema = z
  .object({
    pullRequestId: z.number(),
    status: z.string().optional(),
    url: z.string().optional(),
    sourceRefName: z.string().optional(),
    repository: z.object({ webUrl: z.string().optional() }).loose().optional(),
  })
  .loose();
export type PullRequest = z.infer<typeof prSchema>;

export const prWebUrl = (pr: PullRequest) =>
  pr.repository?.webUrl ? `${pr.repository.webUrl}/pullrequest/${pr.pullRequestId}` : pr.url;

export async function getBranchTip(
  client: AdoClient,
  repo: string,
  branch: string,
): Promise<string | undefined> {
  const { value } = await client.get(`git/repositories/${encodeURIComponent(repo)}/refs`, {
    schema: z.object({ value: z.array(refSchema) }),
    query: { filter: `heads/${branch}` },
  });
  return value.find((r) => r.name === `refs/heads/${branch}`)?.objectId;
}

async function fileExists(
  client: AdoClient,
  repo: string,
  path: string,
  branch: string,
): Promise<boolean> {
  try {
    await client.get(`git/repositories/${encodeURIComponent(repo)}/items`, {
      schema: z.unknown(),
      query: {
        path,
        "versionDescriptor.version": branch,
        "versionDescriptor.versionType": "branch",
      },
    });
    return true;
  } catch (e) {
    if (e instanceof AdoError && e.status === 404) return false;
    throw e;
  }
}

export type FileChange = { path: string; content: string };

/**
 * Commits files to `branch`. The branch is created from `baseBranch` if it does not
 * exist yet; otherwise the commit goes on top of it (re-running an agent updates its PR).
 */
export async function commitToBranch(
  client: AdoClient,
  opts: { repo: string; baseBranch: string; branch: string; files: FileChange[]; message: string },
): Promise<{ commitId?: string; created: boolean }> {
  const existingTip = await getBranchTip(client, opts.repo, opts.branch);
  const baseTip = existingTip ?? (await getBranchTip(client, opts.repo, opts.baseBranch));
  if (!baseTip) throw new Error(`Base branch ${opts.baseBranch} not found in ${opts.repo}`);
  const versionBranch = existingTip ? opts.branch : opts.baseBranch;

  const changes = [];
  for (const f of opts.files) {
    const path = f.path.startsWith("/") ? f.path : `/${f.path}`;
    const exists = await fileExists(client, opts.repo, path, versionBranch);
    changes.push({
      changeType: exists ? "edit" : "add",
      item: { path },
      newContent: { content: f.content, contentType: "rawtext" },
    });
  }

  const res = await client.post(`git/repositories/${encodeURIComponent(opts.repo)}/pushes`, {
    schema: z
      .object({ commits: z.array(z.object({ commitId: z.string() }).loose()).optional() })
      .loose(),
    body: {
      refUpdates: [{ name: `refs/heads/${opts.branch}`, oldObjectId: existingTip ?? baseTip }],
      commits: [{ comment: opts.message, parents: [baseTip], changes }],
    },
  });
  return { commitId: res.commits?.[0]?.commitId, created: !existingTip };
}

export async function findActivePullRequest(
  client: AdoClient,
  repo: string,
  sourceBranch: string,
): Promise<PullRequest | undefined> {
  const { value } = await client.get(`git/repositories/${encodeURIComponent(repo)}/pullrequests`, {
    schema: z.object({ value: z.array(prSchema) }),
    query: {
      "searchCriteria.sourceRefName": `refs/heads/${sourceBranch}`,
      "searchCriteria.status": "active",
    },
  });
  return value[0];
}

/** Opens a PR (or returns the active one for the branch). Never merges or auto-completes. */
export async function createPullRequest(
  client: AdoClient,
  opts: {
    repo: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
    workItemIds?: number[];
    labels?: string[];
    draft?: boolean;
  },
): Promise<{ pr: PullRequest; created: boolean }> {
  const existing = await findActivePullRequest(client, opts.repo, opts.sourceBranch);
  if (existing) return { pr: existing, created: false };
  const pr = await client.post(`git/repositories/${encodeURIComponent(opts.repo)}/pullrequests`, {
    schema: prSchema,
    body: {
      sourceRefName: `refs/heads/${opts.sourceBranch}`,
      targetRefName: `refs/heads/${opts.targetBranch}`,
      title: opts.title,
      description: opts.description.slice(0, 4000),
      isDraft: opts.draft ?? true,
      workItemRefs: (opts.workItemIds ?? []).map((id) => ({ id: String(id) })),
      labels: (opts.labels ?? []).map((name) => ({ name })),
    },
  });
  return { pr, created: true };
}
