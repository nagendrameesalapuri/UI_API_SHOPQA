import { test as base, type Page } from "@playwright/test";

type Json = Record<string, unknown> | unknown[];

/** Network control for UI tests: mock, fail, abort, patch or replay backend calls. */
export class NetworkControl {
  constructor(private readonly page: Page) {}

  /**
   * Answers matching requests with a JSON body (the backend is never called).
   * With `method`, other methods fall through to earlier routes / the network.
   * Routes added later win, so a test can override a default stub.
   */
  async mockJson(url: string | RegExp, body: Json, status = 200, method?: string): Promise<void> {
    await this.page.route(url, (route) => {
      if (method && route.request().method() !== method.toUpperCase()) return route.fallback();
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
  }

  /** Simulates a backend error for matching requests, e.g. fail(/\/api\/cart/, 503). */
  async fail(url: string | RegExp, status = 500, message = "Simulated failure"): Promise<void> {
    await this.mockJson(url, { success: false, message }, status);
  }

  /** Drops matching requests at the network level (net::ERR_FAILED in the browser). */
  async abort(url: string | RegExp): Promise<void> {
    await this.page.route(url, (route) => route.abort("failed"));
  }

  /** Lets the real response through but rewrites its JSON body. */
  async patchJson<T extends Json>(url: string | RegExp, patch: (body: T) => T): Promise<void> {
    await this.page.route(url, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as T;
      await route.fulfill({ response, json: patch(body) });
    });
  }

  /**
   * Replays recorded traffic from a HAR file. Record once with update=true against the
   * real backend, commit the .har, then replay offline with update=false.
   */
  async replayHar(harPath: string, url: string | RegExp, update = false): Promise<void> {
    await this.page.routeFromHAR(harPath, { url, update, notFound: "fallback" });
  }
}

export const test = base.extend<{ network: NetworkControl }>({
  network: async ({ page }, use) => {
    await use(new NetworkControl(page));
  },
});
