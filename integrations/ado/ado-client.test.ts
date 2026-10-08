import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AdoClient, AdoConfigError, AdoError } from "./ado-client";
import { MockAdo } from "../test-utils/mock-fetch";

describe("AdoClient", () => {
  it("builds project URLs with api-version 7.1 and Basic auth for a PAT", async () => {
    const mock = new MockAdo().on("GET", /_apis\/thing$/, { body: { ok: true } });
    await mock
      .client()
      .get("thing", { schema: z.object({ ok: z.boolean() }), query: { a: 1, b: undefined } });
    const call = mock.calls[0];
    expect(call.url).toBe("https://dev.azure.com/org/Proj/_apis/thing?a=1&api-version=7.1");
    expect(call.headers.Authorization).toBe(`Basic ${Buffer.from(":pat").toString("base64")}`);
  });

  it("retries 429 honouring Retry-After, then succeeds", async () => {
    const delays: number[] = [];
    const mock = new MockAdo()
      .on("GET", /x$/, { status: 429, headers: { "Retry-After": "3" } }, 1)
      .on("GET", /x$/, { status: 503 }, 1)
      .on("GET", /x$/, { body: { v: 1 } });
    const client = new AdoClient({
      orgUrl: "https://dev.azure.com/org",
      project: "Proj",
      token: "t",
      authType: "bearer",
      fetch: mock.fetch,
      sleep: async (ms) => void delays.push(ms),
    });
    await expect(client.get("x", { schema: z.object({ v: z.number() }) })).resolves.toEqual({
      v: 1,
    });
    expect(mock.calls).toHaveLength(3);
    expect(delays[0]).toBe(3000);
    expect(mock.calls[0].headers.Authorization).toBe("Bearer t");
  });

  it("does not retry 4xx and reports status and body", async () => {
    const mock = new MockAdo().on("GET", /x$/, { status: 404, body: { message: "nope" } });
    const err = await mock
      .client()
      .get("x", { schema: z.unknown() })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdoError);
    expect((err as AdoError).status).toBe(404);
    expect(mock.calls).toHaveLength(1);
  });

  it("rejects responses that do not match the schema", async () => {
    const mock = new MockAdo().on("GET", /x$/, { body: { id: "not-a-number" } });
    await expect(mock.client().get("x", { schema: z.object({ id: z.number() }) })).rejects.toThrow(
      /unexpected response shape/,
    );
  });

  it("follows x-ms-continuationtoken pages", async () => {
    const mock = new MockAdo().on("GET", /list$/, (c) =>
      c.query.get("continuationToken") === "p2"
        ? { body: { value: [3] } }
        : { body: { value: [1, 2] }, headers: { "x-ms-continuationtoken": "p2" } },
    );
    await expect(mock.client().getAllPages("list", z.number())).resolves.toEqual([1, 2, 3]);
  });

  describe("fromEnv", () => {
    it("prefers the pipeline's System.AccessToken", () => {
      const c = AdoClient.fromEnv({
        SYSTEM_ACCESSTOKEN: "sys",
        SYSTEM_COLLECTIONURI: "https://dev.azure.com/acme/",
        SYSTEM_TEAMPROJECT: "AYCC",
        ADO_PAT: "pat",
      });
      expect(c.orgUrl).toBe("https://dev.azure.com/acme");
      expect(c.project).toBe("AYCC");
    });

    it("lists every missing setting", () => {
      expect(() => AdoClient.fromEnv({})).toThrowError(AdoConfigError);
      expect(() => AdoClient.fromEnv({})).toThrowError(/ADO_ORG.*ADO_PROJECT.*ADO_PAT/);
    });
  });
});
