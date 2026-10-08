import { z } from "zod";
import { createLogger } from "../../src/utils/logger";

// Typed Azure DevOps REST wrapper (api-version 7.1).
// - Auth: $(System.AccessToken) in pipelines (Bearer) or ADO_PAT locally (Basic).
// - Retries 429/5xx with exponential backoff, honouring Retry-After.
// - Every JSON response is validated with a zod schema before callers see it.
// `fetch` is injectable so every module can be unit-tested with mocked HTTP.

export const API_VERSION = "7.1";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type AdoClientOptions = {
  /** e.g. https://dev.azure.com/my-org */
  orgUrl: string;
  project: string;
  token: string;
  authType: "bearer" | "basic";
  fetch?: FetchLike;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type RequestOptions<S extends z.ZodType> = {
  schema: S;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** application/json (default) or application/json-patch+json for work items */
  contentType?: string;
  apiVersion?: string;
  /** false = organisation-level API (no project segment) */
  projectScoped?: boolean;
};

export type AdoResponse<T> = { data: T; headers: Headers };

export class AdoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "AdoError";
  }
}

export class AdoConfigError extends Error {
  name = "AdoConfigError";
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;
const log = createLogger("ado");

export class AdoClient {
  readonly orgUrl: string;
  readonly project: string;
  private readonly authHeader: string;
  private readonly doFetch: FetchLike;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: AdoClientOptions) {
    this.orgUrl = opts.orgUrl.replace(/\/+$/, "");
    this.project = opts.project;
    this.authHeader =
      opts.authType === "bearer"
        ? `Bearer ${opts.token}`
        : `Basic ${Buffer.from(`:${opts.token}`).toString("base64")}`;
    this.doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.maxRetries = opts.maxRetries ?? 4;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Pipeline: SYSTEM_ACCESSTOKEN + SYSTEM_COLLECTIONURI + SYSTEM_TEAMPROJECT (predefined).
   * Local / dashboard: ADO_PAT + ADO_ORG + ADO_PROJECT.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): AdoClient {
    const org = env.ADO_ORG?.trim();
    const orgUrl = org
      ? org.startsWith("http")
        ? org
        : `https://dev.azure.com/${org}`
      : env.SYSTEM_COLLECTIONURI;
    const project = env.ADO_PROJECT?.trim() || env.SYSTEM_TEAMPROJECT;
    const systemToken = env.SYSTEM_ACCESSTOKEN?.trim();
    const pat = env.ADO_PAT?.trim();

    const missing = [
      !orgUrl && "ADO_ORG (or SYSTEM_COLLECTIONURI)",
      !project && "ADO_PROJECT (or SYSTEM_TEAMPROJECT)",
      !systemToken && !pat && "ADO_PAT (or SYSTEM_ACCESSTOKEN)",
    ].filter(Boolean);
    if (missing.length) {
      throw new AdoConfigError(`Azure DevOps is not configured. Missing: ${missing.join(", ")}`);
    }
    return new AdoClient({
      orgUrl: orgUrl!,
      project: project!,
      token: (systemToken || pat)!,
      authType: systemToken ? "bearer" : "basic",
      fetch: fetchImpl,
    });
  }

  url(
    path: string,
    opts: {
      query?: RequestOptions<z.ZodType>["query"];
      apiVersion?: string;
      projectScoped?: boolean;
    } = {},
  ): string {
    const base =
      opts.projectScoped === false
        ? `${this.orgUrl}/_apis`
        : `${this.orgUrl}/${encodeURIComponent(this.project)}/_apis`;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) params.set(k, String(v));
    }
    params.set("api-version", opts.apiVersion ?? API_VERSION);
    return `${base}/${path.replace(/^\//, "")}?${params.toString()}`;
  }

  /** Link to a page in the ADO web UI, e.g. webUrl("_build/results?buildId=1"). */
  webUrl(path: string): string {
    return `${this.orgUrl}/${encodeURIComponent(this.project)}/${path.replace(/^\//, "")}`;
  }

  async request<S extends z.ZodType>(
    method: string,
    path: string,
    opts: RequestOptions<S>,
  ): Promise<AdoResponse<z.infer<S>>> {
    const url = this.url(path, opts);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = opts.contentType ?? "application/json";

    const response = await this.fetchWithRetry(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await response.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new AdoError(
          `${method} ${path}: response is not JSON`,
          response.status,
          text.slice(0, 500),
        );
      }
    }
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) {
      throw new AdoError(
        `${method} ${path}: unexpected response shape: ${parsed.error.message}`,
        response.status,
        text.slice(0, 500),
      );
    }
    return { data: parsed.data, headers: response.headers };
  }

  get<S extends z.ZodType>(path: string, opts: RequestOptions<S>) {
    return this.request("GET", path, opts).then((r) => r.data);
  }
  post<S extends z.ZodType>(path: string, opts: RequestOptions<S>) {
    return this.request("POST", path, opts).then((r) => r.data);
  }
  patch<S extends z.ZodType>(path: string, opts: RequestOptions<S>) {
    return this.request("PATCH", path, opts).then((r) => r.data);
  }

  /**
   * GETs every page of a list API that pages with the x-ms-continuationtoken header.
   */
  async getAllPages<T>(
    path: string,
    itemSchema: z.ZodType<T>,
    query: RequestOptions<z.ZodType>["query"] = {},
  ): Promise<T[]> {
    const schema = z.object({ value: z.array(itemSchema) });
    const items: T[] = [];
    let continuationToken: string | undefined;
    for (let page = 0; page < 100; page++) {
      const { data, headers } = await this.request("GET", path, {
        schema,
        query: { ...query, continuationToken },
      });
      items.push(...data.value);
      continuationToken = headers.get("x-ms-continuationtoken") ?? undefined;
      if (!continuationToken) break;
    }
    return items;
  }

  /** Downloads a binary resource (e.g. an artifact zip) with the same auth and retries. */
  async download(url: string): Promise<Uint8Array> {
    const response = await this.fetchWithRetry(url, {
      method: "GET",
      headers: { Authorization: this.authHeader },
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.doFetch(url, init);
      } catch (error) {
        if (attempt >= this.maxRetries) throw error;
        await this.sleep(this.backoff(attempt));
        continue;
      }
      if (response.ok) return response;

      if (RETRYABLE(response.status) && attempt < this.maxRetries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoff(attempt);
        log.warn("retrying", {
          status: response.status,
          attempt: attempt + 1,
          delayMs: delay,
          url: url.split("?")[0],
        });
        await this.sleep(delay);
        continue;
      }
      const body = await response.text();
      throw new AdoError(
        `${init.method} ${url.split("?")[0]} failed: ${response.status} ${response.statusText} ${body.slice(0, 300)}`,
        response.status,
        body,
      );
    }
  }

  private backoff(attempt: number): number {
    return Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
  }
}
