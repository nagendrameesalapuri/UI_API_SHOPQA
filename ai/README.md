# ai/

| Folder     | Purpose                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`    | `llm-provider.ts` (interface + adapters + `none`), `redact.ts`, `guardrails.ts`, `cost-log.ts`, `prompts.ts`, `audit.ts`                                                    |
| `rules/`   | `triage-rules.ts` — ordered rule table (add patterns here), `signature.ts` — error normalisation for clustering                                                             |
| `agents/`  | `triage.agent.ts` (+ CLI, history, report, bugs), `story-to-test.agent.ts` (+ `story/`), `healer.agent.ts` (+ `healer/`)                                                    |
| `prompts/` | Versioned prompt templates (front-matter `id`, `version`; `{{placeholders}}`)                                                                                               |
| `evals/`   | `golden/triage-golden.json` (23 samples, 3 from real ShopQA failures) + runner (`npm run eval:triage`); `broken-suite/` deliberately failing demo; `fixtures/` sample story |

Everything works with `LLM_PROVIDER=none`. See docs/how-to-llm.md.
