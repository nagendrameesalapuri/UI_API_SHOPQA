import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readUsage } from "./cost-log";
import { GuardrailError, Guardrails } from "./guardrails";
import {
  AnthropicProvider,
  createLlmProvider,
  LlmResponseError,
  LlmUnavailableError,
  NoneProvider,
  validateJson,
} from "./llm-provider";

const tmpUsage = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "llm-")), "usage.jsonl");
const opts = { agent: "test", promptId: "p", promptVersion: "1.0.0" };
const limits = { maxInputChars: 5000, maxOutputTokens: 500, maxCallsPerRun: 5, budgetUsd: 1 };

type Captured = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
function fakeFetch(
  replies: { status?: number; body: unknown }[],
  captured: Captured[],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    captured.push({ url, headers, body: JSON.parse(String(init?.body ?? "{}")) });
    const reply = replies.shift() ?? { status: 500, body: { error: "no more replies" } };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const chat = (content: string) => ({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
});

describe("createLlmProvider", () => {
  it("defaults to NoneProvider, which throws LlmUnavailableError", async () => {
    const p = createLlmProvider({});
    expect(p).toBeInstanceOf(NoneProvider);
    await expect(p.complete("x", opts)).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(p.json(z.object({}), "x", opts)).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("reports missing configuration for a selected provider", () => {
    expect(() => createLlmProvider({ LLM_PROVIDER: "anthropic" })).toThrowError(
      /ANTHROPIC_API_KEY, ANTHROPIC_MODEL/,
    );
    expect(() => createLlmProvider({ LLM_PROVIDER: "azure-openai" })).toThrowError(
      LlmUnavailableError,
    );
  });
});

describe("AzureOpenAIProvider", () => {
  it("calls the deployment endpoint with api-key and logs usage + cost", async () => {
    const captured: Captured[] = [];
    const usageFile = tmpUsage();
    const p = createLlmProvider(
      {
        LLM_PROVIDER: "azure-openai",
        AZURE_OPENAI_ENDPOINT: "https://res.openai.azure.com/",
        AZURE_OPENAI_DEPLOYMENT: "gpt-dep",
        AZURE_OPENAI_API_KEY: "k",
      },
      {
        fetch: fakeFetch([{ body: chat("hello") }], captured),
        guardrails: new Guardrails(limits),
        usageFile,
      },
    );
    await expect(p.complete("hi", { ...opts, system: "sys" })).resolves.toBe("hello");
    expect(captured[0].url).toBe(
      "https://res.openai.azure.com/openai/deployments/gpt-dep/chat/completions?api-version=2024-10-21",
    );
    expect(captured[0].headers["api-key"]).toBe("k");
    expect(captured[0].body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(readUsage(usageFile)[0]).toMatchObject({
      provider: "azure-openai",
      model: "gpt-dep",
      inputTokens: 100,
      outputTokens: 20,
      ok: true,
    });
  });
});

describe("OpenAICompatibleProvider json()", () => {
  const make = (replies: { status?: number; body: unknown }[], captured: Captured[] = []) =>
    createLlmProvider(
      {
        LLM_PROVIDER: "openai-compatible",
        OPENAI_COMPAT_BASE_URL: "http://localhost:11434/v1",
        OPENAI_COMPAT_MODEL: "llama",
        OPENAI_COMPAT_API_KEY: "t",
      },
      {
        fetch: fakeFetch(replies, captured),
        guardrails: new Guardrails(limits),
        usageFile: tmpUsage(),
      },
    );
  const schema = z.object({ category: z.string() });

  it("parses fenced JSON", async () => {
    const captured: Captured[] = [];
    await expect(
      make([{ body: chat('```json\n{"category":"FLAKY"}\n```') }], captured).json(
        schema,
        "q",
        opts,
      ),
    ).resolves.toEqual({ category: "FLAKY" });
    expect(captured[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(captured[0].headers.authorization).toBe("Bearer t");
  });

  it("retries once with the validation error, then succeeds", async () => {
    const captured: Captured[] = [];
    const p = make(
      [{ body: chat('{"wrong":1}') }, { body: chat('{"category":"ENVIRONMENT"}') }],
      captured,
    );
    await expect(p.json(schema, "q", opts)).resolves.toEqual({ category: "ENVIRONMENT" });
    expect(String((captured[1].body.messages as { content: string }[])[0].content)).toContain(
      "previous answer was invalid",
    );
  });

  it("fails with LlmResponseError after two invalid answers", async () => {
    await expect(
      make([{ body: chat("nope") }, { body: chat("still nope") }]).json(schema, "q", opts),
    ).rejects.toBeInstanceOf(LlmResponseError);
  });

  it("turns HTTP errors into LlmResponseError", async () => {
    await expect(
      make([{ status: 500, body: { error: "x" } }]).complete("q", opts),
    ).rejects.toBeInstanceOf(LlmResponseError);
  });
});

describe("AnthropicProvider (official SDK with a mocked fetch)", () => {
  it("sends model, max_tokens and system; returns text and token usage", async () => {
    const captured: Captured[] = [];
    const usageFile = tmpUsage();
    const fetchImpl = fakeFetch(
      [
        {
          body: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-opus-5",
            content: [{ type: "text", text: '{"category":"TEST_ISSUE"}' }],
            stop_reason: "end_turn",
            usage: { input_tokens: 50, output_tokens: 10 },
          },
        },
      ],
      captured,
    );
    const p = new AnthropicProvider(
      { apiKey: "sk-test", model: "claude-opus-5", fetch: fetchImpl },
      new Guardrails(limits),
      usageFile,
    );
    await expect(
      p.json(z.object({ category: z.string() }), "classify", { ...opts, system: "be brief" }),
    ).resolves.toEqual({ category: "TEST_ISSUE" });
    expect(captured[0].url).toMatch(/\/v1\/messages$/);
    expect(captured[0].headers["x-api-key"]).toBe("sk-test");
    expect(captured[0].body).toMatchObject({
      model: "claude-opus-5",
      system: "be brief",
      max_tokens: 500,
    });
    expect(readUsage(usageFile)[0]).toMatchObject({
      provider: "anthropic",
      inputTokens: 50,
      outputTokens: 10,
    });
  });

  it("treats a refusal as LlmResponseError (callers fall back to rules)", async () => {
    const fetchImpl = fakeFetch(
      [
        {
          body: {
            id: "m",
            type: "message",
            role: "assistant",
            model: "m",
            content: [],
            stop_reason: "refusal",
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
      ],
      [],
    );
    const p = new AnthropicProvider(
      { apiKey: "k", model: "m", fetch: fetchImpl },
      new Guardrails(limits),
      tmpUsage(),
    );
    await expect(p.complete("x", opts)).rejects.toBeInstanceOf(LlmResponseError);
  });
});

describe("guardrails", () => {
  it("rejects oversized input and stops after the call limit", async () => {
    const g = new Guardrails({ ...limits, maxCallsPerRun: 1, maxInputChars: 10 });
    expect(() => g.checkInput("x".repeat(11))).toThrowError(GuardrailError);
    g.beforeCall();
    expect(() => g.beforeCall()).toThrowError(/call limit/);
  });

  it("stops once the budget is spent", () => {
    const g = new Guardrails({ ...limits, budgetUsd: 0.01 });
    g.beforeCall();
    g.record(0.02);
    expect(() => g.beforeCall()).toThrowError(/budget/);
  });
});

describe("validateJson", () => {
  it("extracts the JSON object from surrounding prose", () => {
    expect(validateJson(z.object({ a: z.number() }), 'Sure! {"a": 1} hope that helps')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });
});
