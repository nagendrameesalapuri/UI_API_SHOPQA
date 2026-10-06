import { APIResponse, expect } from "@playwright/test";
import {
  ErrorResponse,
  errorResponseSchema,
  validationErrorResponseSchema,
} from "../api/schemas/common.schema";

// Checks status, the { error, code } body shape, and optionally the code.
// The failure message carries the body, so a wrong status shows what came back.
export async function expectError(
  response: APIResponse,
  status: number,
  code?: string,
): Promise<ErrorResponse> {
  const text = await response.text();
  expect(response.status(), `${response.url()} -> ${text}`).toBe(status);
  const parsed = errorResponseSchema.safeParse(JSON.parse(text));
  expect(
    parsed.success,
    `Error body should be { error, code } like the rest of the API, got: ${text}`,
  ).toBe(true);
  const body = parsed.data!;
  if (code) {
    expect(body.code).toBe(code);
  }
  return body;
}

// 400 VALIDATION_ERROR; returns the names of the rejected fields
export async function expectValidationError(response: APIResponse): Promise<string[]> {
  const text = await response.text();
  expect(response.status(), `${response.url()} -> ${text}`).toBe(400);
  const body = validationErrorResponseSchema.parse(JSON.parse(text));
  return [...new Set(body.details.map(({ field }) => field))];
}

export async function expectStatus(response: APIResponse, status: number) {
  const text = await response.text();
  expect(response.status(), `${response.url()} -> ${text}`).toBe(status);
  return text ? JSON.parse(text) : undefined;
}
