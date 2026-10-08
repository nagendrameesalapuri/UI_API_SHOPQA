# How to enable an LLM (later)

Today `LLM_PROVIDER=none`: triage, story-to-test and the healer run on deterministic rules. Turning an
LLM on only adds a second opinion for uncertain cases; if it fails, times out, is over budget, or
returns invalid JSON, the rule result is kept. **Check the company AI/data policy first.**

## Providers

| `LLM_PROVIDER`      | Required variables                                                                                                                     | Notes                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `none` (default)    | —                                                                                                                                      | Rules only                                                                      |
| `azure-openai`      | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY`, optional `AZURE_OPENAI_API_VERSION` (default `2024-10-21`) | Data stays in your Azure tenant — usually the first one a company approves      |
| `anthropic`         | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (e.g. `claude-opus-5`)                                                                          | Uses the official `@anthropic-ai/sdk`; low effort for short JSON tasks          |
| `openai-compatible` | `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_MODEL`, optional `OPENAI_COMPAT_API_KEY`                                                      | Any `/chat/completions` server, e.g. a local Ollama `http://localhost:11434/v1` |

Locally: put them in `.env`. Pipelines: put them in the `playwright-ai` variable group (keys as secrets,
ideally from Key Vault) and map them in the step's `env:` (see `ai-story-to-test.yml`).

## Guardrails (per run)

| Variable                                            | Default | Effect                                                        |
| --------------------------------------------------- | ------- | ------------------------------------------------------------- |
| `LLM_MAX_INPUT_CHARS`                               | 12000   | Larger prompts are refused (inputs are truncated before that) |
| `LLM_MAX_OUTPUT_TOKENS`                             | 1500    | Cap on every response                                         |
| `LLM_MAX_CALLS_PER_RUN`                             | 20      | After that, rules only                                        |
| `LLM_BUDGET_USD`                                    | 1.00    | Stops when the estimated spend reaches it                     |
| `LLM_PRICE_INPUT_PER_1K`, `LLM_PRICE_OUTPUT_PER_1K` | 0       | Your contract prices, for cost estimates                      |

## Privacy

Before any call, `ai/core/redact.ts` masks emails, phone numbers, JWTs, bearer/basic tokens, API keys,
`password=`-style secrets, VINs, UK/Indian vehicle registrations, and person names from `REDACT_NAMES`
or `data/redact.json` (copy `data/redact.example.json`). Add project-specific patterns there.

## Observability

- `reports/ai-usage.jsonl`: one line per call — agent, prompt id + version, provider, model, tokens,
  estimated cost, latency, ok.
- `reports/agent-audit.jsonl`: every agent action with hashed inputs and the outcome.
- `ai-triage.md` gets an _AI cost_ section when an LLM was used.

## Prompts

Versioned Markdown in `ai/prompts/` (`id`, `version` front-matter, `{{placeholders}}`):
`triage-failure`, `plan-from-story`, `generate-spec`, `fix-spec`, `heal-locator`. Bump the version when
you change a prompt, then compare with `npm run eval:triage` (it uses the configured provider).

## Rollout checklist

1. Approval for the provider + data classification of test failures.
2. Set the provider variables in `.env`; run `npm run eval:triage` — accuracy must not drop.
3. Run `npm run triage` on a real `results.json`; review `ai-triage.md` and `reports/ai-usage.jsonl`.
4. Add the variables to `playwright-ai`, set budgets, and enable in pipelines.
