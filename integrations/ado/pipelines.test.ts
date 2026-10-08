import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockAdo } from "../test-utils/mock-fetch";
import { commitToBranch, createPullRequest } from "./git";
import { getRun, getTimeline, listRuns, queueRun, readArtifactJson } from "./pipelines";

describe("pipelines", () => {
  it("queueRun passes the branch and stringified template parameters", async () => {
    const mock = new MockAdo().on("POST", /pipelines\/3\/runs$/, {
      body: { id: 11, state: "inProgress" },
    });
    const run = await queueRun(
      mock.client(),
      3,
      { releaseVersion: "2026.10", shards: 4, createBugs: false },
      "main",
    );
    expect(run.id).toBe(11);
    expect(mock.calls[0].body).toEqual({
      resources: { repositories: { self: { refName: "refs/heads/main" } } },
      templateParameters: { releaseVersion: "2026.10", shards: "4", createBugs: "false" },
    });
  });

  it("getRun / listRuns / getTimeline", async () => {
    const mock = new MockAdo()
      .on("GET", /pipelines\/3\/runs\/11$/, {
        body: { id: 11, state: "completed", result: "failed" },
      })
      .on("GET", /pipelines\/3\/runs$/, {
        body: {
          value: [
            { id: 1, state: "completed" },
            { id: 5, state: "completed" },
          ],
        },
      })
      .on("GET", /builds\/11\/timeline$/, {
        body: { records: [{ id: "a", type: "Stage", name: "Test", state: "completed" }] },
      });
    const client = mock.client();
    await expect(getRun(client, 3, 11)).resolves.toMatchObject({ result: "failed" });
    expect((await listRuns(client, 3)).map((r) => r.id)).toEqual([5, 1]);
    expect((await getTimeline(client, 11))[0].name).toBe("Test");
  });

  it("readArtifactJson downloads the zip and parses the file", async () => {
    const zip = zipSync({ "ai-triage/ai-triage.json": strToU8(JSON.stringify({ total: 3 })) });
    const mock = new MockAdo()
      .on("GET", /builds\/8\/artifacts$/, (c) =>
        c.query.get("artifactName")
          ? { body: { name: "ai-triage", resource: { downloadUrl: "https://dl.example/a?x=1" } } }
          : { body: { value: [{ name: "ai-triage", resource: {} }] } },
      )
      .on("GET", /^\/a$/, { bytes: zip });
    const json = await readArtifactJson(
      mock.client(),
      8,
      "ai-triage",
      "ai-triage.json",
      z.object({ total: z.number() }),
    );
    expect(json).toEqual({ total: 3 });
    expect(mock.calls.at(-1)?.url).toBe("https://dl.example/a?x=1&format=zip");
  });

  it("readArtifactJson returns undefined when the artifact is missing", async () => {
    const mock = new MockAdo().on("GET", /builds\/8\/artifacts$/, { body: { value: [] } });
    await expect(
      readArtifactJson(mock.client(), 8, "ai-triage", "x.json", z.unknown()),
    ).resolves.toBeUndefined();
  });
});

describe("git (agent PR flow)", () => {
  it("creates a new branch from main with add/edit changes, then a draft PR linked to the work item", async () => {
    const mock = new MockAdo()
      .on("GET", /refs$/, (c) =>
        c.query.get("filter") === "heads/main"
          ? { body: { value: [{ name: "refs/heads/main", objectId: "abc" }] } }
          : { body: { value: [] } },
      )
      .on("GET", /items$/, (c) =>
        c.query.get("path") === "/README.md" ? { body: {} } : { status: 404, body: {} },
      )
      .on("POST", /pushes$/, { body: { commits: [{ commitId: "def" }] } })
      .on("GET", /pullrequests$/, { body: { value: [] } })
      .on("POST", /pullrequests$/, {
        body: { pullRequestId: 5, repository: { webUrl: "https://repo" } },
      });
    const client = mock.client();

    const commit = await commitToBranch(client, {
      repo: "shop",
      baseBranch: "main",
      branch: "ai/story-12",
      message: "AI: story 12",
      files: [
        { path: "specs/story-12.md", content: "# plan" },
        { path: "README.md", content: "x" },
      ],
    });
    expect(commit).toEqual({ commitId: "def", created: true });
    const push = mock.callsTo("POST", /pushes$/)[0].body as {
      refUpdates: { name: string; oldObjectId: string }[];
      commits: { changes: { changeType: string }[] }[];
    };
    expect(push.refUpdates[0]).toEqual({ name: "refs/heads/ai/story-12", oldObjectId: "abc" });
    expect(push.commits[0].changes.map((c) => c.changeType)).toEqual(["add", "edit"]);

    const { pr, created } = await createPullRequest(client, {
      repo: "shop",
      sourceBranch: "ai/story-12",
      targetBranch: "main",
      title: "t",
      description: "d",
      workItemIds: [12],
      labels: ["ai-generated"],
    });
    expect(created).toBe(true);
    expect(pr.pullRequestId).toBe(5);
    expect(mock.callsTo("POST", /pullrequests$/)[0].body).toMatchObject({
      isDraft: true,
      workItemRefs: [{ id: "12" }],
      labels: [{ name: "ai-generated" }],
    });
    // The agent never completes/merges
    expect(mock.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("returns the existing active PR instead of opening a second one", async () => {
    const mock = new MockAdo().on("GET", /pullrequests$/, {
      body: { value: [{ pullRequestId: 9 }] },
    });
    const { pr, created } = await createPullRequest(mock.client(), {
      repo: "shop",
      sourceBranch: "ai/story-12",
      targetBranch: "main",
      title: "t",
      description: "d",
    });
    expect([pr.pullRequestId, created]).toEqual([9, false]);
  });
});
