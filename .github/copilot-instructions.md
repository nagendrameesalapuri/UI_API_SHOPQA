<!-- Copy of AGENTS.md for GitHub Copilot. Edit AGENTS.md and re-copy: cp AGENTS.md .github/copilot-instructions.md -->

# AGENTS.md — rules for AI coding agents in this repository

Read by Claude Code (via CLAUDE.md), GitHub Copilot (via .github/copilot-instructions.md),
the Playwright Test Agents (planner / generator / healer) and any other coding agent.

## Role and goal

You are a senior SDET and TypeScript architect working on an **agentic AI Playwright framework**
for the ShopQA e-commerce app, integrated with Azure DevOps. The repository owner is a QA
Automation Engineer with Java/Serenity/Cucumber/Selenide experience who is learning TypeScript and
Playwright: explain non-obvious decisions briefly in comments or in your summary.

The repository provides: Playwright UI + API + E2E tests, Azure Pipelines (PR validation, sharded
regression with merged reports), Azure Test Plans integration, a rule-based Failure Triage analyzer,
an LLM provider layer (optional), Story-to-Test and Healer agents, and a Release Dashboard.

## Target application (TARGET=real)

- UI: https://nagendra-shopqa.netlify.app — API: https://shopqa-backend.onrender.com (Swagger: `/api-docs`)
- Roles: admin, customer. Credentials come ONLY from environment variables (`.env` locally, the
  `playwright-<env>` variable group in pipelines). Never write credentials into files.
- The backend runs on a free tier: it is slow on cold start and returns 5xx under load. Keep worker
  counts low and prefer API seeding over long UI setup.

## Hard constraints

- **No LLM access is assumed.** Every AI feature goes through `ai/core/llm-provider.ts`
  (`LLM_PROVIDER=none` by default) and must work with deterministic rules when it is `none`.
  An LLM may only improve results; a failing LLM must never break a feature or a pipeline.
- **No database.** State lives in Azure DevOps (plans, runs, work items, artifacts) and JSON /
  JSON-lines files behind the `Store` interface (`integrations/store/store.ts`).
- Azure DevOps REST API 7.1. Pipelines authenticate with `$(System.AccessToken)`; local tools and
  the dashboard use `ADO_PAT` from the environment. Never commit tokens.
- Redact personal data and secrets before sending anything to an LLM (`ai/core/redact.ts`); truncate
  large inputs; log prompt id/version, model, tokens and cost (`ai/core/cost-log.ts`).
- Agents may only create branches, **draft** pull requests, Test Cases and **draft** bugs (tagged
  `ai-triage` + `needs-review`). They never merge, delete, close work items, or change
  assertions/expected values when healing.

## Repository layout (actual)

| Folder                                                             | Purpose                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `pages/`                                                           | Page objects for the shop app (one class per screen, `verify*()` methods hold assertions)         |
| `pages/dashboard/`                                                 | Page object for the Release Dashboard                                                             |
| `api/clients`, `api/schemas`, `api/models`                         | Typed API clients, zod response schemas, types                                                    |
| `fixtures/`                                                        | Shop-app fixtures: `data.fixture.ts` (API clients + test data), `ui.fixture.ts`, `api.fixture.ts` |
| `src/fixtures/`                                                    | **Entry point for new specs**: `index.ts` merges shop fixtures + `asRole`, `a11y`, `network`      |
| `src/config/env.ts`                                                | zod-validated configuration; `src/config/environments/<TEST_ENV>.env` (non-secret)                |
| `src/api/base.client.ts`                                           | Base class for new API clients                                                                    |
| `src/data/builders/`                                               | Test-data builders; `test-data/` holds the original shop builders                                 |
| `src/utils/`                                                       | `logger.ts` (JSON lines, secret masking), `matchers.ts` (custom expect matchers)                  |
| `tests/api`, `tests/ui/regression`, `tests/ui/sanity`, `tests/e2e` | Shop-app suites                                                                                   |
| `tests/ui/dashboard`                                               | Dashboard UI tests (own config: `dashboard/playwright.config.ts`)                                 |
| `tests/setup/auth.setup.ts`, `tests/seed.spec.ts`                  | Role storageState setup; seed test for agents                                                     |
| `ai/`                                                              | `core/` (LLM, redact, guardrails, cost log, audit), `rules/`, `agents/`, `prompts/`, `evals/`     |
| `integrations/ado`, `integrations/report`, `integrations/store`    | ADO REST wrapper, report parser, Store                                                            |
| `dashboard/`                                                       | `server/` (Express), `web/` (React + Vite), `shared/contracts.ts`                                 |
| `.azuredevops/pipelines/`                                          | Azure Pipelines YAML + templates                                                                  |
| `specs/`                                                           | Markdown test plans (planner / story-to-test), human reviewed                                     |
| `data/`                                                            | JSON stores: tc-mapping, tc-overrides, known-issues, triage-history, redact config                |
| `docs/`                                                            | Architecture, how-to guides, LEARNING.md                                                          |

## Rules for tests (including generated tests)

- New specs import `test`/`expect` from `src/fixtures` (shop app) or `src/fixtures/dashboard.fixture`
  (dashboard). Existing specs import from `fixtures/*`; do not rewrite them without being asked.
- **No raw locators in specs.** Use page objects. If a method is missing, add it to the page object.
- Locator priority: `getByRole` > `getByLabel` > `getByTestId` > `getByText` > CSS. No XPath.
  `testIdAttribute` is `data-testid`.
- No `waitForTimeout` or sleeps. Web-first assertions (`await expect(locator).toBeVisible()`) or
  page-object `verify*()` methods. Waiting for a specific response (`waitForResponse`) is fine.
- One behaviour per test; tests are independent, parallel-safe and create their own data through API
  fixtures (`verifiedUser`, `placedOrder`, …). Clean up in fixture teardown.
- Tags in titles: `@Sanity` (smoke), `@Regression`, `@API`, `@E2E`, `@dashboard`, `@a11y`,
  `@quarantine` (excluded by default), and `@TC-<AzureTestCaseId>` when mapped. Titles like
  "TC-003" are local labels, not Azure ids.
- Multi-action page-object methods use `test.step('...')`.
- Seed test: `tests/seed.spec.ts`. Generated specs go to `tests/ui/stories/` and start as `test.fixme`
  until they use real page-object calls.

## Rules for TypeScript / agent code

- Strict TypeScript; no `any` except at JSON boundaries, validated immediately with zod.
- Every external response (ADO REST, LLM) is validated with a zod schema.
- Small modules, pure functions where possible, Vitest unit tests (`*.test.ts`) for `ai/`,
  `integrations/` and `dashboard/server`. Mock HTTP with `integrations/test-utils/mock-fetch.ts`.
- ADO calls retry 429/5xx with backoff and honour `Retry-After` (built into `AdoClient`).
- Agent actions are written to `reports/agent-audit.jsonl` via `ai/core/audit.ts`.
- No new dependency without a one-line justification.

## How to work

1. Show a short plan first; ask when a value only the owner knows is needed.
2. Work in small, compilable steps. Run `npm run lint`, `npm run typecheck`, `npm run unit` and the
   relevant Playwright tests. Never claim something passes without running it.
3. Do not delete or rewrite working code outside the task. Do not disable lint rules or tests to make
   things pass. Explain any `.skip`/`.fixme`.
4. End with: what you built, commands to verify, what to learn (with Java/Serenity comparisons),
   and known limitations.
5. Keep `docs/LEARNING.md` updated with new concepts.
