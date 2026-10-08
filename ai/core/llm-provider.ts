import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { appendUsage, estimateCost } from "./cost-log";
import { GuardrailError, Guardrails } from "./guardrails";

// One interface, four adapters. Every AI feature calls LlmProvider; with
// LLM_PROVIDER=none (the default) the NoneProvider throws LlmUnavailableError and the
// caller falls back to its deterministic rules. Think of it as a Java interface with a
// Null Object implementation that fails loudly instead of silently.

export type LlmProviderName = "none" | "azure-openai" | "anthropic" | "openai-compatible";

export type LlmCallOptions = {
  agent: string;
  promptId: string;
  promptVersion: string;
  system?: string;
  maxTokens?: number;
};

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  complete(prompt: string, opts: LlmCallOptions): Promise<string>;
  /** Asks for JSON, validates with zod, retries once with the validation error, then fails. */
  json<T>(schema: z.ZodType<T>, prompt: string, opts: LlmCallOptions): Promise<T>;
  /** Calls made and estimated spend in this run */
  usage(): { calls: number; spentUsd: number };
}

export class LlmUnavailableError extends Error {
  name = "LlmUnavailableError";
}
export class LlmResponseError extends Error {
  name = "LlmResponseError";
}

/** True for errors where callers should quietly use their rule-based fallback. */
export const isFallbackError = (e: unknown) =>
  e instanceof LlmUnavailableError || e instanceof GuardrailError || e instanceof LlmResponseError;

export class NoneProvider implements LlmProvider {
  readonly name = "none" as const;
  readonly model = "none";
  async complete(): Promise<string> {
    throw new LlmUnavailableError("No LLM configured (LLM_PROVIDER=none); using rule-based logic");
  }
  async json<T>(): Promise<T> {
    return this.complete() as never;
  }
  usage() {
    return { calls: 0, spentUsd: 0 };
  }
}

type RawCompletion = { text: string; inputTokens: number; outputTokens: number };
export type FetchLike = typeof fetch;

/** Shared behaviour: guardrails, cost log, JSON extraction + validation with one retry. */
abstract class BaseProvider implements LlmProvider {
  abstract readonly name: LlmProviderName;
  abstract readonly model: string;

  constructor(
    protected readonly guardrails: Guardrails,
    protected readonly usageFile?: string,
  ) {}

  usage() {
    return this.guardrails.usage;
  }

  protected abstract send(
    prompt: string,
    system: string | undefined,
    maxTokens: number,
  ): Promise<RawCompletion>;

  async complete(prompt: string, opts: LlmCallOptions): Promise<string> {
    this.guardrails.checkInput(prompt);
    this.guardrails.beforeCall();
    const started = Date.now();
    const maxTokens = Math.min(
      opts.maxTokens ?? this.guardrails.limits.maxOutputTokens,
      this.guardrails.limits.maxOutputTokens,
    );
    let result: RawCompletion | undefined;
    try {
      result = await this.send(prompt, opts.system, maxTokens);
      return result.text;
    } finally {
      const inputTokens = result?.inputTokens ?? 0;
      const outputTokens = result?.outputTokens ?? 0;
      const costUsd = estimateCost(inputTokens, outputTokens);
      this.guardrails.record(costUsd);
      appendUsage(
        {
          agent: opts.agent,
          promptId: opts.promptId,
          promptVersion: opts.promptVersion,
          provider: this.name,
          model: this.model,
          inputTokens,
          outputTokens,
          costUsd,
          ms: Date.now() - started,
          ok: result !== undefined,
        },
        this.usageFile,
      );
    }
  }

  async json<T>(schema: z.ZodType<T>, prompt: string, opts: LlmCallOptions): Promise<T> {
    const instruction = "\n\nRespond with a single JSON object only. No prose, no code fences.";
    let text = await this.complete(prompt + instruction, opts);
    let problem = validateJson(schema, text);
    if (problem.ok) return problem.value;

    text = await this.complete(
      `${prompt}${instruction}\n\nYour previous answer was invalid: ${problem.error}\nPrevious answer:\n${text.slice(0, 2000)}`,
      opts,
    );
    problem = validateJson(schema, text);
    if (problem.ok) return problem.value;
    throw new LlmResponseError(`LLM returned invalid JSON twice: ${problem.error}`);
  }
}

/** Extracts the first JSON object from model text (tolerates ```json fences) and validates it. */
export function validateJson<T>(
  schema: z.ZodType<T>,
  text: string,
): { ok: true; value: T } | { ok: false; error: string } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) };
}

const chatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z
    .object({ prompt_tokens: z.number(), completion_tokens: z.number() })
    .partial()
    .optional(),
});

async function postChat(
  doFetch: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<RawCompletion> {
  const res = await doFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new LlmResponseError(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
  const parsed = chatResponseSchema.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new LlmResponseError(`Unexpected LLM response: ${parsed.error.message}`);
  return {
    text: parsed.data.choices[0].message.content ?? "",
    inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
    outputTokens: parsed.data.usage?.completion_tokens ?? 0,
  };
}

const messages = (prompt: string, system?: string) => [
  ...(system ? [{ role: "system", content: system }] : []),
  { role: "user", content: prompt },
];

export class AzureOpenAIProvider extends BaseProvider {
  readonly name = "azure-openai" as const;
  readonly model: string;
  constructor(
    private readonly cfg: {
      endpoint: string;
      deployment: string;
      apiVersion: string;
      apiKey: string;
    },
    guardrails: Guardrails,
    private readonly doFetch: FetchLike = fetch,
    usageFile?: string,
  ) {
    super(guardrails, usageFile);
    this.model = cfg.deployment;
  }
  protected send(prompt: string, system: string | undefined, maxTokens: number) {
    const url = `${this.cfg.endpoint.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(this.cfg.deployment)}/chat/completions?api-version=${this.cfg.apiVersion}`;
    return postChat(
      this.doFetch,
      url,
      { "api-key": this.cfg.apiKey },
      { messages: messages(prompt, system), max_completion_tokens: maxTokens },
    );
  }
}

export class OpenAICompatibleProvider extends BaseProvider {
  readonly name = "openai-compatible" as const;
  readonly model: string;
  constructor(
    private readonly cfg: { baseUrl: string; apiKey?: string; model: string },
    guardrails: Guardrails,
    private readonly doFetch: FetchLike = fetch,
    usageFile?: string,
  ) {
    super(guardrails, usageFile);
    this.model = cfg.model;
  }
  protected send(prompt: string, system: string | undefined, maxTokens: number) {
    const headers: Record<string, string> = this.cfg.apiKey
      ? { Authorization: `Bearer ${this.cfg.apiKey}` }
      : {};
    return postChat(
      this.doFetch,
      `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`,
      headers,
      {
        model: this.cfg.model,
        messages: messages(prompt, system),
        max_tokens: maxTokens,
      },
    );
  }
}

/** Anthropic Messages API through the official SDK. */
export class AnthropicProvider extends BaseProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private readonly client: Anthropic;
  constructor(
    cfg: { apiKey: string; model: string; baseURL?: string; fetch?: FetchLike },
    guardrails: Guardrails,
    usageFile?: string,
  ) {
    super(guardrails, usageFile);
    this.model = cfg.model;
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      fetch: cfg.fetch,
      maxRetries: 2,
    });
  }
  protected async send(
    prompt: string,
    system: string | undefined,
    maxTokens: number,
  ): Promise<RawCompletion> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        // Short classification/JSON tasks: low effort keeps cost and latency down
        output_config: { effort: "low" },
        messages: [{ role: "user", content: prompt }],
      });
      if (response.stop_reason === "refusal") {
        throw new LlmResponseError("Model declined the request; using rule-based result");
      }
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new LlmResponseError(`Anthropic API ${error.status ?? ""}: ${error.message}`);
      }
      throw error;
    }
  }
}

function required(env: NodeJS.ProcessEnv, names: string[]): Record<string, string> {
  const missing = names.filter((n) => !env[n]);
  if (missing.length)
    throw new LlmUnavailableError(
      `LLM_PROVIDER=${env.LLM_PROVIDER} but missing: ${missing.join(", ")}`,
    );
  return Object.fromEntries(names.map((n) => [n, env[n]!]));
}

/** Picks the adapter from LLM_PROVIDER. Model names, endpoints and keys only come from env. */
export function createLlmProvider(
  env: NodeJS.ProcessEnv = process.env,
  opts: { guardrails?: Guardrails; fetch?: FetchLike; usageFile?: string } = {},
): LlmProvider {
  const guardrails = opts.guardrails ?? new Guardrails();
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  switch ((env.LLM_PROVIDER ?? "none") as LlmProviderName) {
    case "none":
      return new NoneProvider();
    case "azure-openai": {
      const c = required(env, [
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_DEPLOYMENT",
        "AZURE_OPENAI_API_KEY",
      ]);
      return new AzureOpenAIProvider(
        {
          endpoint: c.AZURE_OPENAI_ENDPOINT,
          deployment: c.AZURE_OPENAI_DEPLOYMENT,
          apiKey: c.AZURE_OPENAI_API_KEY,
          apiVersion: env.AZURE_OPENAI_API_VERSION ?? "2024-10-21",
        },
        guardrails,
        doFetch,
        opts.usageFile,
      );
    }
    case "anthropic": {
      const c = required(env, ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"]);
      return new AnthropicProvider(
        { apiKey: c.ANTHROPIC_API_KEY, model: c.ANTHROPIC_MODEL, fetch: opts.fetch },
        guardrails,
        opts.usageFile,
      );
    }
    case "openai-compatible": {
      const c = required(env, ["OPENAI_COMPAT_BASE_URL", "OPENAI_COMPAT_MODEL"]);
      return new OpenAICompatibleProvider(
        {
          baseUrl: c.OPENAI_COMPAT_BASE_URL,
          model: c.OPENAI_COMPAT_MODEL,
          apiKey: env.OPENAI_COMPAT_API_KEY,
        },
        guardrails,
        doFetch,
        opts.usageFile,
      );
    }
    default:
      throw new LlmUnavailableError(`Unknown LLM_PROVIDER "${env.LLM_PROVIDER}"`);
  }
}
