import { AdoClient, type FetchLike } from "../ado/ado-client";

// Tiny HTTP mock for unit tests: routes are matched by "METHOD path-regex" in order,
// every call is recorded so tests can assert on URLs and bodies (like WireMock, in-process).

export type MockReply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** raw bytes body (downloads) */
  bytes?: Uint8Array;
};
type Handler = MockReply | ((call: RecordedCall) => MockReply);
export type RecordedCall = {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
};

export class MockAdo {
  readonly calls: RecordedCall[] = [];
  private routes: { method: string; pattern: RegExp; handler: Handler; times?: number }[] = [];

  on(method: string, pattern: RegExp, handler: Handler, times?: number): this {
    this.routes.push({ method, pattern, handler, times });
    return this;
  }

  fetch: FetchLike = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method ?? "GET").toUpperCase();
    const call: RecordedCall = {
      method,
      url,
      path: decodeURIComponent(u.pathname),
      query: u.searchParams,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    this.calls.push(call);
    const route = this.routes.find(
      (r) => r.method === method && r.pattern.test(call.path) && r.times !== 0,
    );
    if (!route) return new Response(`no mock for ${method} ${call.path}`, { status: 404 });
    if (route.times !== undefined) route.times--;
    const reply = typeof route.handler === "function" ? route.handler(call) : route.handler;
    const body = reply.bytes ?? (reply.body === undefined ? "" : JSON.stringify(reply.body));
    return new Response(body as BodyInit, { status: reply.status ?? 200, headers: reply.headers });
  };

  callsTo(method: string, pattern: RegExp): RecordedCall[] {
    return this.calls.filter((c) => c.method === method && pattern.test(c.path));
  }

  client(): AdoClient {
    return new AdoClient({
      orgUrl: "https://dev.azure.com/org",
      project: "Proj",
      token: "pat",
      authType: "basic",
      fetch: this.fetch,
      sleep: async () => undefined,
    });
  }
}
