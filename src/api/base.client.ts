import { type APIRequestContext, type APIResponse, expect, test } from "@playwright/test";
import type { z } from "zod";
import { createLogger, maskSecrets } from "../utils/logger";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestOptions = {
  token?: string;
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  data?: unknown;
  /** Expected status; default: any 2xx */
  expectStatus?: number;
};

const log = createLogger("api");

/**
 * Base class for new API clients (the existing ones in api/clients predate it).
 * Every call: runs inside a test.step, asserts the status with "METHOD URL" and the
 * body in the failure message, validates the JSON with a zod schema, and logs the
 * request/response with secrets masked (LOG_LEVEL=debug).
 *
 *   class CouponClient extends BaseClient {
 *     list(token: string) { return this.get("/api/admin/coupons", couponListSchema, { token }); }
 *   }
 */
export abstract class BaseClient {
  constructor(
    protected readonly request: APIRequestContext,
    protected readonly baseUrl: string,
  ) {}

  protected get<S extends z.ZodType>(path: string, schema: S, opts: RequestOptions = {}) {
    return this.send("GET", path, schema, opts);
  }
  protected post<S extends z.ZodType>(path: string, schema: S, opts: RequestOptions = {}) {
    return this.send("POST", path, schema, opts);
  }
  protected put<S extends z.ZodType>(path: string, schema: S, opts: RequestOptions = {}) {
    return this.send("PUT", path, schema, opts);
  }
  protected patch<S extends z.ZodType>(path: string, schema: S, opts: RequestOptions = {}) {
    return this.send("PATCH", path, schema, opts);
  }
  protected delete<S extends z.ZodType>(path: string, schema: S, opts: RequestOptions = {}) {
    return this.send("DELETE", path, schema, opts);
  }

  /** Raw call without status/schema checks, for negative tests. */
  protected raw(method: Method, path: string, opts: RequestOptions = {}): Promise<APIResponse> {
    const headers = { ...opts.headers };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    return this.request.fetch(this.url(path), {
      method,
      headers,
      params: opts.params,
      data: opts.data,
    });
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }

  private async send<S extends z.ZodType>(
    method: Method,
    path: string,
    schema: S,
    opts: RequestOptions,
  ): Promise<z.infer<S>> {
    const url = this.url(path);
    return test.step(`${method} ${path}`, async () => {
      log.debug("request", { method, url, params: opts.params, body: maskSecrets(opts.data) });
      const response = await this.raw(method, path, opts);
      const text = await response.text();
      log.debug("response", { method, url, status: response.status(), body: text.slice(0, 2000) });

      const context = `${method} ${url} -> ${response.status()}\n${text.slice(0, 1000)}`;
      if (opts.expectStatus !== undefined) {
        expect(response.status(), context).toBe(opts.expectStatus);
      } else {
        expect(response.ok(), context).toBe(true);
      }

      const parsed = schema.safeParse(text ? JSON.parse(text) : undefined);
      if (!parsed.success) {
        throw new Error(
          `${method} ${url}: response does not match schema\n${parsed.error.message}`,
        );
      }
      return parsed.data;
    });
  }
}
