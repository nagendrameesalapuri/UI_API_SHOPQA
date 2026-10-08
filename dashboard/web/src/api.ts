import { z } from "zod";
import {
  configSchema,
  errorSchema,
  releaseSchema,
  runProgressSchema,
  runResultsSchema,
  runSummarySchema,
  trendPointSchema,
  type NewRunRequest,
} from "../../shared/contracts";

// Typed API client. Every response is validated with the shared zod contract, so a
// server/web mismatch shows up as a clear error instead of a blank screen.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(schema: z.ZodType<T>, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body: unknown = res.headers.get("content-type")?.includes("json")
    ? await res.json()
    : undefined;
  if (!res.ok) {
    const err = errorSchema.safeParse(body);
    throw new ApiError(
      err.success ? err.data.error : `Request failed (${res.status})`,
      res.status,
      err.success ? err.data.details : undefined,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(`Unexpected response from ${url}`, res.status, parsed.error.issues);
  return parsed.data;
}

export const api = {
  config: () => request(configSchema, "/api/config"),
  startRun: (body: NewRunRequest) =>
    request(runSummarySchema, "/api/runs", { method: "POST", body: JSON.stringify(body) }),
  runs: () => request(z.array(runSummarySchema), "/api/runs"),
  progress: (id: string) =>
    request(runProgressSchema, `/api/runs/${encodeURIComponent(id)}/progress`),
  /** null while results are not ready (404) */
  results: async (id: string) => {
    try {
      return await request(runResultsSchema, `/api/runs/${encodeURIComponent(id)}/results`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  trend: (n = 10) => request(z.array(trendPointSchema), `/api/trend?n=${n}`),
  releases: () => request(z.array(releaseSchema), "/api/releases"),
};
