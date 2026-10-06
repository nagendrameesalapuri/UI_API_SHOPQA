import { APIRequestContext, APIResponse, test } from "@playwright/test";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// Fluent builder for raw API calls, used where a test needs the status code or
// error body rather than a parsed result:
//   await api.path("cart/items").auth(token).body({ productId }).postRequest();
// Each call resets the builder, so one handler can be reused for many requests.
export class RequestHandler {
  private request: APIRequestContext;
  private baseURL: string | undefined;
  private apiBaseUrl: string;
  private apiPath: string = "";
  private queryParams: object = {};
  private apiHeaders: Record<string, string> = {};
  private apiBody: object | undefined;

  constructor(request: APIRequestContext, apiBaseUrl: string) {
    this.request = request;
    this.apiBaseUrl = apiBaseUrl;
  }

  url(baseUrl: string) {
    this.baseURL = baseUrl;
    return this;
  }

  path(apiPath: string) {
    this.apiPath = apiPath;
    return this;
  }

  params(queryParams: object) {
    this.queryParams = queryParams;
    return this;
  }

  headers(apiHeaders: Record<string, string>) {
    this.apiHeaders = { ...this.apiHeaders, ...apiHeaders };
    return this;
  }

  // Adds "Authorization: Bearer <token>"
  auth(accessToken: string) {
    return this.headers({ Authorization: `Bearer ${accessToken}` });
  }

  body(apiBody: object) {
    this.apiBody = apiBody;
    return this;
  }

  async getRequest() {
    return await this.send("GET");
  }

  async postRequest() {
    return await this.send("POST");
  }

  async putRequest() {
    return await this.send("PUT");
  }

  async patchRequest() {
    return await this.send("PATCH");
  }

  async deleteRequest() {
    return await this.send("DELETE");
  }

  private async send(method: HttpMethod): Promise<APIResponse> {
    const fullUrl = `${this.baseURL ?? this.apiBaseUrl}${this.apiPath}`;
    const options = {
      method,
      headers: this.apiHeaders,
      params: this.queryParams as { [key: string]: string | number | boolean },
      data: this.apiBody,
    };
    this.reset();

    let response!: APIResponse;
    await test.step(`${method} request to: ${fullUrl}`, async () => {
      response = await this.request.fetch(fullUrl, options);
    });
    return response;
  }

  private reset() {
    this.baseURL = undefined;
    this.apiPath = "";
    this.queryParams = {};
    this.apiHeaders = {};
    this.apiBody = undefined;
  }
}
