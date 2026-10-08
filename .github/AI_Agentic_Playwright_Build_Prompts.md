# Build Prompts — Agentic AI Playwright Framework (Azure DevOps)

A ready-to-paste prompt pack for GitHub Copilot agent mode (VS Code or IntelliJ), Claude Code, or any coding agent.

## How to use this pack

1. **Fill the placeholders** in the Master Prompt (everything in `<ANGLE_BRACKETS>`).
2. **Save the Master Prompt in the repo** so the AI reads it on every request:
   - GitHub Copilot → `.github/copilot-instructions.md`
   - Claude Code → `CLAUDE.md`
   - Any other tool → `AGENTS.md`, and paste it at the start of each new chat.
3. **Run the phase prompts one at a time, in order.** Don't paste them all together.
4. **After every phase:** run the commands in that phase's "Done when" list yourself, read the diff, commit, and then paste the **Review Prompt** at the end of this file.
5. If the AI gets stuck or goes off track, paste the **Recovery Prompt**.

> Start with the practice target (saucedemo + restful-booker). Switch `TARGET` to your real application only after Phase 6 works. Check your company's AI/data policy before pointing any AI tool at internal systems.

---

## MASTER PROMPT (paste first; keep as AGENTS.md / copilot-instructions.md)

```text
# ROLE
You are a senior SDET and TypeScript architect. You are building, step by step with me, a production-grade
"agentic AI Playwright framework" integrated with Azure DevOps. I am a QA Automation Engineer with strong
Java/Serenity/Cucumber/Selenide experience and I am learning TypeScript and Playwright while we build this.
Explain non-obvious decisions briefly in comments or in your summary so I learn from the code.

# GOAL (end state)
A single repository that provides:
1. A Playwright Test framework (TypeScript) for UI + API + hybrid tests, with page objects, fixtures,
   typed config, test data builders, tagging, visual and accessibility checks.
2. Azure DevOps pipelines: PR validation and a sharded regression pipeline with merged reports.
3. Azure DevOps integration: create a Test Plan for a release version, map tests to Test Cases by @TC-<id>
   tags, publish automated results to Test Plans test points, create Bug drafts.
4. A Failure Triage analyzer that classifies every failed test as PRODUCT_BUG, TEST_ISSUE, ENVIRONMENT
   or FLAKY, and writes a summary.
5. AI agents: Playwright Test Agents (planner/generator/healer) for IDE use, plus a Story-to-Test agent that
   turns an Azure DevOps user story into a reviewed test pull request.
6. A Release Dashboard web UI: user enters a release version → Test Plan is created → regression pipeline
   is triggered → progress is shown → failures are triaged → results dashboard.

# HARD CONSTRAINTS (very important)
- NO LLM ACCESS TODAY. Every AI feature must sit behind an `LlmProvider` interface with these modes:
  `none` (default), `azure-openai`, `anthropic`, `openai-compatible`. In `none` mode every feature
  must still work using deterministic, rule-based logic (e.g. regex triage, template-based test plans).
  The LLM only improves results when it is configured; it never makes a feature unusable.
- NO DATABASE. Persist state only in: (a) Azure DevOps itself (Test Plans, test runs, work items,
  pipeline runs, build artifacts) and (b) JSON / JSON-lines files (repo `data/` folder, pipeline artifacts,
  or a local cache folder for the dashboard server). Design data access behind a small `Store` interface
  so a database could be added later without rewriting callers.
- Azure DevOps organisation: <ADO_ORG>   Project: <ADO_PROJECT, e.g. AYCC>   Repo: <REPO_NAME>
  Use Azure DevOps REST API version 7.1. In pipelines authenticate with $(System.AccessToken);
  locally and in the dashboard server use a PAT from an environment variable (never commit it).
- Secrets only from environment variables / Azure DevOps variable groups linked to Key Vault.
  Never hard-code credentials, tokens, URLs of real environments, or customer data.
- Before sending anything to an LLM, redact emails, names, tokens, vehicle registrations/VINs and
  other personal data. Truncate large inputs. Log prompt version, model, tokens and cost.
- Agents may only create branches, pull requests and DRAFT bugs. They never merge, never delete,
  never close work items, and never change test assertions/expected values when "healing".

# TARGET APPLICATION
TARGET=real  →  UI: https://nagendra-shopqa.netlify.app   API: https://shopqa-backend.onrender.com

Roles: Admin, Customer (two customer accounts). Credentials are NOT stored here: see .env (local) / variable group playwright-<env> (pipelines).
swagger: https://shopqa-backend.onrender.com/api-docs/#

Domain for the real app: <SHORT DOMAIN DESCRIPTION, e.g. VOR (Vehicle Off Road) case management>
Build everything against TARGET=practice first; keep target-specific code in page objects, API clients,
test data and config only, so switching targets does not touch the framework core.

# TECH STACK (do not substitute without asking)
- Node.js 20 LTS+, TypeScript (strict), @playwright/test (latest stable), npm.
- zod (config + schema validation), dotenv, @faker-js/faker, @axe-core/playwright.
- ESLint (typescript-eslint + eslint-plugin-playwright, with no-floating-promises), Prettier, Husky, lint-staged.
- tsx for running TypeScript scripts. Vitest for unit tests of non-Playwright code (ai/, integrations/).
- Dashboard: Node + Express (or Fastify) backend and a React + Vite frontend, served together.
- Azure Pipelines YAML; Docker image based on mcr.microsoft.com/playwright with the SAME version as
  @playwright/test.

# REPOSITORY STRUCTURE (create and keep to this)
.azuredevops/pipelines/        pr-validation.yml, regression.yml, release-run.yml, templates/*.yml
ai/core/                       llm-provider.ts (interface + adapters + 'none'), redact.ts, guardrails.ts, cost-log.ts
ai/agents/                     triage.agent.ts, story-to-test.agent.ts, healer.agent.ts
ai/rules/                      triage-rules.ts (deterministic classifier used in 'none' mode and as LLM fallback)
ai/prompts/                    *.md prompt templates, versioned (front-matter: id, version)
ai/evals/                      golden cases + runner that measures accuracy
integrations/ado/              ado-client.ts (typed REST wrapper), test-plans.ts, test-results.ts,
                               pipelines.ts, work-items.ts, artifacts.ts
integrations/report/           playwright-json-parser.ts (normalised Failure model)
src/config/                    env.ts (zod), environments/*.env (non-secret values only)
src/fixtures/                  index.ts (exports test/expect), pages.fixture.ts, api.fixture.ts, auth.fixture.ts
src/pages/                     base.page.ts + one page object per screen
src/components/                reusable widgets (table, modal, date picker, toast)
src/api/                       base.client.ts + clients/*.client.ts
src/data/                      builders/*.builder.ts, static/*.json
src/utils/                     logger.ts, dates.ts, matchers.ts (custom expect matchers)
tests/setup/                   auth.setup.ts
tests/api/  tests/ui/<feature>/  tests/e2e/  tests/visual/  tests/a11y/  tests/seed.spec.ts
specs/                         Markdown test plans (from planner / story-to-test), human reviewed
dashboard/server/  dashboard/web/
data/                          JSON stores (triage-history.json, flaky.json, known-issues.json, mappings)
docs/                          architecture.md, how-to-*.md, LEARNING.md (concepts explained for me)
playwright.config.ts  playwright.service.config.ts (optional cloud browsers)  Dockerfile  README.md

# CODING RULES FOR TESTS
- Specs import `test`/`expect` ONLY from `src/fixtures`. No raw locators in specs — use page objects.
- Locator priority: getByRole > getByLabel > getByTestId > getByText > CSS. No XPath. No waitForTimeout.
  Use web-first assertions (expect(locator).toBeVisible() etc.), never manual sleeps.
- One behaviour per test. Tests are independent, parallel-safe and create their own data (API seeding
  preferred over UI setup). Clean up in fixture teardown.
- Tags in titles: @smoke / @regression / @api / @visual / @a11y and @TC-<AzureTestCaseId> when mapped.
- Multi-action page-object methods are wrapped in test.step('...') for readable reports.
- Reporters: html (local), list (local), blob + junit + json (CI). trace on-first-retry,
  screenshot only-on-failure, video retain-on-failure.

# CODING RULES FOR TYPESCRIPT / AGENT CODE
- Strict TypeScript, no `any` except at JSON boundaries (then validate with zod immediately).
- Every external response (ADO REST, LLM) is validated with a zod schema.
- Small modules with clear names; pure functions where possible; unit tests with Vitest for ai/ and integrations/.
- Retries with backoff for ADO REST calls (429/5xx), honour Retry-After.
- Structured logging (JSON lines) for every agent action: timestamp, agent, action, inputs hash, outcome.
- No new dependency without a one-line justification in your summary.

# HOW YOU WORK WITH ME
1. For each task: first show a short PLAN (files to create/change, key decisions, open questions).
   If something is ambiguous or needs a value only I know, ASK instead of guessing. Then implement.
2. Work in small, compilable increments. After implementing, RUN: `npm run lint`, `npm run typecheck`,
   and the relevant tests. Fix failures before saying you are done. Never claim something passes
   unless you ran it and saw it pass.
3. Do not delete or rewrite working code outside the task scope. Do not disable lint rules or tests
   to make things pass. Do not mark tests `.skip`/`.fixme` without telling me why.
4. End every task with: (a) what you built, (b) commands I should run to verify, (c) what I should
   learn from it (2–4 bullets, concepts explained simply, with Java/Serenity comparisons when helpful),
   (d) known limitations / TODOs.
5. Keep docs/LEARNING.md updated with new concepts introduced in each phase.
```

---

## PHASE 1 — Scaffold, config and quality gates

```text
Phase 1 of the build. Follow the Master Prompt.

Create the project scaffold:
- package.json with scripts: test, test:smoke (--grep @smoke), test:regression, test:api, test:ui,
  lint, format, typecheck, report (show-report), unit (vitest), triage, dashboard:dev, dashboard:build.
- tsconfig.json (strict, path aliases @src/*, @ai/*, @integrations/*), ESLint flat config with
  typescript-eslint, eslint-plugin-playwright and @typescript-eslint/no-floating-promises,
  Prettier, Husky pre-commit running lint-staged + typecheck.
- The full folder structure from the Master Prompt (empty folders get a short README.md explaining purpose).
- src/config/env.ts: zod schema for TEST_ENV (dev|qa|uat), TARGET (practice|real), BASE_URL, API_URL,
  user credentials per role, LLM_PROVIDER (none|azure-openai|anthropic|openai-compatible, default none),
  ADO_ORG, ADO_PROJECT, ADO_PAT (optional locally). Load src/config/environments/<TEST_ENV>.env.
  Fail fast with a readable error listing missing variables.
- .env.example documenting every variable. .gitignore for reports, test-results, .auth, .env, cache.
- playwright.config.ts: projects setup → chromium, firefox (UI depend on setup), api project; CI detection
  via TF_BUILD; reporters as in the Master Prompt; testIdAttribute 'data-testid'.
- README.md: prerequisites, install, run commands. docs/LEARNING.md started (TypeScript basics for Java devs).

Done when: `npm ci && npm run lint && npm run typecheck` pass and `npx playwright test --list` runs.
```

## PHASE 2 — Core framework: page objects, fixtures, authentication

```text
Phase 2. Follow the Master Prompt. TARGET=practice (saucedemo).

Build:
- src/pages/base.page.ts: abstract path, open(), waitUntilReady(), helpers; no assertions about business flows.
- Page objects: LoginPage, InventoryPage, CartPage, CheckoutInfoPage, CheckoutOverviewPage, CheckoutCompletePage.
- src/components/: HeaderComponent (cart badge, menu), ProductCard component.
- src/fixtures: test.extend that injects all page objects; role-based auth via tests/setup/auth.setup.ts
  saving storageState per role into .auth/<role>.json (standard_user, problem_user); a fixture
  `asRole(role)` or separate projects so tests can choose a role.
- src/utils/matchers.ts: one custom matcher example (e.g. toHaveCartCount(n)) registered via expect.extend.
- tests/ui/: 10 meaningful tests across login (valid, locked-out, invalid), inventory (sort, add/remove),
  cart, checkout happy path and validation errors. Use tags; at least 3 @smoke.
- tests/seed.spec.ts: logs in via fixtures and lands on the inventory page (used later by Playwright agents).

Done when: `npm run test:ui` passes on chromium and firefox, fully parallel, 3 times in a row
(`npx playwright test --repeat-each=3`), and specs contain zero raw locators.
```

## PHASE 3 — API layer, test data and hybrid tests

```text
Phase 3. Follow the Master Prompt. API target: restful-booker.

Build:
- src/api/base.client.ts wrapping APIRequestContext: typed get/post/put/patch/delete, zod-validated
  responses, automatic expect(res).toBeOK() with method+URL in the message, request/response logging
  with secrets masked.
- src/api/clients/auth.client.ts (token) and booking.client.ts (CRUD).
- src/data/builders/booking.builder.ts using faker with overrides (aBooking({ ... })).
- api fixture exposing clients; worker-scoped auth token fixture.
- tests/api/: 8 tests (create, read, update, partial update, delete, negative cases, schema validation).
- tests/e2e/: 2 hybrid examples showing the pattern "seed data via API → verify via UI". Since the two
  practice apps are unrelated, implement the pattern with a clear comment and a mock route
  (page.route) that serves API-created data to a simple UI, OR document the pattern with a realistic
  skeleton for TARGET=real. Explain the choice.

Done when: `npm run test:api` passes 3 times in a row and unit-level helpers have Vitest tests.
```

## PHASE 4 — Advanced framework features

```text
Phase 4. Follow the Master Prompt.

Add:
- Network control: a fixture helper to mock/route API calls; one HAR record/replay example.
- Visual testing: tests/visual with toHaveScreenshot, masks for dynamic content, sensible maxDiffPixelRatio;
  document that baselines must be generated inside the Docker image.
- Accessibility: an `a11y` fixture using @axe-core/playwright (wcag2a, wcag2aa), failing only on serious and
  critical violations, attaching the full report to the test.
- Flaky handling: retries in CI; @quarantine tag excluded from regression by default via grepInvert.
- Dockerfile using mcr.microsoft.com/playwright:v<same version>-noble, non-root, npm ci, default command
  runs the regression; npm script `docker:test`.
- Optional cloud browsers: playwright.service.config.ts using @azure/playwright createAzurePlaywrightConfig
  with DefaultAzureCredential, used only when PLAYWRIGHT_SERVICE_URL is set. Document setup in docs/.
- Reporters verified: blob, junit (reports/junit.xml), json (reports/results.json) in CI mode.

Done when: all suites pass locally and inside Docker (`npm run docker:test`), and CI-mode reporters produce
the three report files.
```

## PHASE 5 — Azure DevOps pipelines

```text
Phase 5. Follow the Master Prompt.

Create in .azuredevops/pipelines/:
- templates/install-steps.yml: UseNode@1 (20.x), Cache@2 for npm, npm ci, optional browser install
  (parameter), OR container job using the Playwright Docker image (parameter to choose).
- templates/test-job.yml: parameters grep, shards, environment, project; strategy parallel = shards;
  runs `npx playwright test --shard=$(System.JobPositionInPhase)/$(System.TotalJobsInPhase)`;
  maps secrets explicitly via env:; PublishTestResults@2 (JUnit, condition always()); publishes the
  blob report as artifact blob-<n>.
- templates/report-steps.yml: downloads blob-* artifacts, `npx playwright merge-reports --reporter html,json`
  with PLAYWRIGHT_JSON_OUTPUT_NAME=reports/results.json, publishes html-report and results-json artifacts.
- pr-validation.yml: trigger on PRs to main; lint, typecheck, unit tests, @smoke on chromium.
- regression.yml: nightly schedule (cron in UTC with an IST comment) + manual; parameters environment,
  grep (default @regression), shards (default 4), releaseVersion (optional), testPlanId (optional);
  stages Test → Report → Triage → Publish (later phases plug in; leave clearly marked placeholder
  steps that are skipped when the script does not exist yet). Report and later stages run with condition always().
- Variable group naming convention playwright-<env>; document required variables and Key Vault linking
  in docs/how-to-pipelines.md, including how to grant the build service permission for Test Plans and Work Items.

Done when: YAML is valid (explain how I can validate it in Azure DevOps), templates are reused, no secrets in
YAML, and docs explain step by step how to create the pipelines in Azure DevOps.
```

## PHASE 6 — Azure DevOps integration: Test Plans, results, bugs

```text
Phase 6. Follow the Master Prompt. Use REST API version 7.1. Everything is unit-tested with mocked HTTP.

Build integrations/ado/:
- ado-client.ts: base URL https://dev.azure.com/{org}/{project}/_apis, auth from System.AccessToken
  (pipeline) or ADO_PAT (local), JSON + JSON-Patch support, retries/backoff for 429/5xx, zod validation.
- test-plans.ts:
  * createReleasePlan(releaseVersion, areaPath, iteration) → POST testplan/plans; idempotent: if a plan
    named "Regression <releaseVersion>" exists, reuse it.
  * ensureSuites(planId, structure) → static suites per feature folder, or query-based suites using a
    WIQL query on tags.
  * addTestCases(planId, suiteId, testCaseIds).
  * getTestPoints(planId, suiteId).
- test-mapping.ts: scan Playwright test titles/annotations for @TC-<id>; produce a mapping file
  data/tc-mapping.json; report unmapped tests and Test Cases that have no automated test.
- test-results.ts: publishResultsToPlan(planId, resultsJson) → create an automated test run for the plan's
  test points (POST test/runs with plan id and pointIds), PATCH results with outcome, duration, error
  message and stack, attach screenshot/trace links where possible, then set run state Completed.
- work-items.ts: getWorkItem(id) with relations; createBugDraft({ title, repro, severity, tags, links })
  using JSON-Patch on $Bug, always tagged 'ai-triage' and 'needs-review', state left at the default.
- pipelines.ts: queueRun(pipelineId, templateParameters, branch) → POST pipelines/{id}/runs;
  getRun(pipelineId, runId); listArtifacts(buildId); downloadArtifact(buildId, name).
- CLI entry points (tsx): `npm run ado:create-plan -- --release 2026.10`, `npm run ado:publish-results -- --plan <id>`,
  `npm run ado:map-tests`.
- Wire `ado:publish-results` into regression.yml's Publish stage when testPlanId is provided.

Done when: Vitest covers all modules with mocked responses, and docs/how-to-ado.md explains PAT scopes needed
(Test Management read & write, Work Items read & write, Build read & execute, Code read & write for PRs).
```

## PHASE 7 — Failure Triage analyzer (works without an LLM)

```text
Phase 7. Follow the Master Prompt. This must be fully useful with LLM_PROVIDER=none.

Build:
- integrations/report/playwright-json-parser.ts: parse merged results.json into a normalised Failure model:
  testId, title, file, project, tags, tcId, status (failed/flaky/timedOut), retries, error message,
  stack, failing step (from test.step titles), attachments (trace/screenshot/video paths), duration.
- ai/rules/triage-rules.ts: deterministic classifier with ordered, documented rules, each returning
  { category, confidence, reason, ruleId }:
  * passed on retry / Playwright status 'flaky' → FLAKY
  * net::ERR_*, ECONNREFUSED, ENOTFOUND, HTTP 5xx, 502/503/504, gateway/timeout from backend → ENVIRONMENT
  * 401/403, login page shown unexpectedly, expired token → ENVIRONMENT (auth)
  * "locator resolved to 0 elements", "strict mode violation", waiting for locator timeouts on
    elements → TEST_ISSUE (locator)
  * assertion mismatch on business values (expected X received Y) with stable history → PRODUCT_BUG candidate
  * data conflicts (duplicate, 409, already exists) → TEST_ISSUE (data)
  * fallback → UNKNOWN (needs human)
  Rules live in one table so I can add new patterns without touching logic.
- Clustering: group failures by a normalised error signature (strip ids, numbers, timestamps, UUIDs)
  so one root cause = one entry.
- History without a database: data/triage-history.json updated per run (append-only, capped length),
  plus support for downloading the previous N runs' triage artifacts via integrations/ado/pipelines.ts.
  Use history to boost FLAKY confidence (intermittent) and PRODUCT_BUG confidence (consistent since build X).
- ai/agents/triage.agent.ts: runs rules first; IF an LLM provider is configured, sends only the redacted,
  truncated failure context for UNKNOWN or low-confidence items and merges the answer (schema-validated);
  if the LLM fails, keep the rule result. Never blocks the pipeline.
- Outputs: reports/ai-triage.json (machine), reports/ai-triage.md (human summary: totals by category,
  top clusters, new failures vs. known, flaky list, links to traces), and an optional Teams webhook message.
- Optional flag --create-bugs: create bug drafts only for PRODUCT_BUG with confidence ≥ 0.8 and not already
  linked to an open bug with the same signature (search by tag/signature in title).
- ai/evals: 20 golden failure samples with expected categories + `npm run eval:triage` that prints accuracy.
- Wire into regression.yml Triage stage (condition always()), publishing ai-triage artifacts.

Done when: `npm run triage -- --results reports/results.json` produces both outputs on a run with
deliberately broken tests of each category, eval accuracy is printed, and everything works with LLM_PROVIDER=none.
```

## PHASE 8 — LLM provider layer and guardrails

```text
Phase 8. Follow the Master Prompt.

Build ai/core/:
- llm-provider.ts: interface LlmProvider { complete(prompt, opts): Promise<string>; json<T>(schema, prompt, opts): Promise<T> }
  with adapters: NoneProvider (throws a typed 'LlmUnavailable' error that callers catch to fall back),
  AzureOpenAIProvider, AnthropicProvider, OpenAICompatibleProvider. Selected by LLM_PROVIDER.
  Model names, endpoints and keys come only from env variables.
- json<T>(): ask for JSON, validate with zod, retry once with the validation error, then fail.
- redact.ts: masks emails, phone numbers, tokens/keys, JWTs, vehicle registrations/VINs (configurable regex list),
  person names from a configurable list; unit-tested.
- guardrails.ts: max input chars, max output tokens, max calls per run, per-run cost budget; abort cleanly.
- cost-log.ts: JSON-lines log in reports/ai-usage.jsonl (agent, promptId, promptVersion, model, tokens, cost, ms).
- ai/prompts/: prompt templates as Markdown with front-matter (id, version) and {{placeholders}};
  a tiny renderer. Prompt files: triage-failure.md, plan-from-story.md, generate-spec.md, fix-spec.md, heal-locator.md.

Done when: all providers are unit-tested with mocked HTTP, NoneProvider fallback paths are tested in triage,
and docs/how-to-llm.md explains how to enable a provider later (e.g. once the company approves Azure OpenAI).
```

## PHASE 9 — Playwright Test Agents + Story-to-Test agent

```text
Phase 9. Follow the Master Prompt.

Part A — IDE agents:
- Run/prepare `npx playwright init-agents` for my editor (<vscode | claude>) and document it in
  docs/how-to-playwright-agents.md: planner → specs/*.md, generator → tests, healer → fixes.
- Make tests/seed.spec.ts use our fixtures so generated tests follow our page objects.
- Ensure the Master Prompt rules (AGENTS.md / copilot-instructions.md) cover generated-test conventions.

Part B — ai/agents/story-to-test.agent.ts (CLI: `npm run agent:story -- --id <workItemId> [--dry-run]`):
1. Fetch the user story + acceptance criteria + linked Test Cases via integrations/ado/work-items.ts.
2. Build a test plan:
   - LLM_PROVIDER=none: parse acceptance criteria (Given/When/Then, bullet lists, numbered lists) into a
     Markdown scenario plan specs/story-<id>.md using templates, with TODO markers where judgment is needed.
   - LLM configured: use prompts/plan-from-story.md to produce a richer plan (positive, negative, edge cases),
     schema-validated.
3. Optionally create/update Test Cases in Azure Test Plans for each scenario and record their ids.
4. Generate spec skeletons:
   - none: deterministic spec files using our fixtures and page objects, with test.step per Given/When/Then
     and `test.fixme` + TODO comments where page-object methods do not exist yet.
   - LLM: prompts/generate-spec.md with existing page objects, fixtures and seed test as context; then
     validate with tsc + eslint + run the new specs with --repeat-each=3; on failure feed errors back via
     prompts/fix-spec.md at most 2 times, then stop and report "needs human".
5. Create branch ai/story-<id>, commit, open a PR linked to the work item, labelled 'ai-generated';
   PR description lists scenarios, created Test Case ids, validation results and TODOs. Never merge.
- Pipeline ai-story-to-test.yml: manual with parameter storyId, runs the agent with System.AccessToken.

Done when: --dry-run on a sample story JSON fixture produces specs/story-<id>.md and compilable spec skeletons
in 'none' mode, and the PR flow is covered by unit tests with mocked ADO calls.
```

## PHASE 10 — Release Dashboard UI (no database)

```text
Phase 10. Follow the Master Prompt.

Build dashboard/ (Express or Fastify backend + React + Vite frontend, one `npm run dashboard:dev`):

Workflow screen "New regression run":
1. User enters release version (e.g. 2026.10.1), environment, test scope (grep/tags), optional suites.
2. Backend: integrations/ado/test-plans.createReleasePlan → ensure suites → add mapped Test Cases.
3. Backend: integrations/ado/pipelines.queueRun(regression pipeline id, { releaseVersion, testPlanId,
   environment, grep }).
4. UI shows a live progress timeline: Plan created → Pipeline queued → Running (per shard) →
   Reports merged → Triage done → Results published (poll the backend every 15–30 s).

Results dashboard for a run:
- KPI tiles: total, passed, failed, flaky, skipped, pass rate, duration.
- Failures grouped by triage category and by cluster, each with error summary, triage reason, links to
  the Azure DevOps build, trace/HTML report artifact, Test Case, and bug draft (if created).
- Trend view over the last N runs (pass rate, flaky count, duration).
- Release history list (release version → plan → runs → outcome).

Data without a database:
- Source of truth is Azure DevOps: Test Plans, pipeline runs, test runs, and the ai-triage.json artifact.
- Backend caches fetched data as JSON files in dashboard/.cache (TTL-based), behind the Store interface.
- The ADO PAT lives ONLY on the server (env var); the browser never sees it. Add simple access control
  (e.g. basic auth or Entra ID sign-in placeholder) and document it.

Quality: TypeScript strict on both sides, zod-validated API contracts shared between server and web,
loading/error/empty states, responsive layout, accessible components; Playwright tests for the dashboard
itself in tests/ui/dashboard with the backend mocked via page.route.

Done when: with a mocked ADO layer (`DASHBOARD_MOCK=true`) the full flow can be demonstrated locally end to end,
and docs/how-to-dashboard.md explains running it against real Azure DevOps and hosting options
(e.g. Azure App Service / container) — no database required.
```

## PHASE 11 — Healer, hardening and documentation

```text
Phase 11. Follow the Master Prompt.

- ai/agents/healer.agent.ts: for TEST_ISSUE (locator) failures only: read the failing step and error,
  inspect the page object, propose a new locator following the locator priority (rule-based candidates from
  the error-context / accessibility snapshot in 'none' mode; LLM via prompts/heal-locator.md when configured),
  re-run the test, and open a PR with the page-object change only. Never edit assertions. Max 2 attempts.
- Audit log for all agents (reports/agent-audit.jsonl). Cost summary appended to ai-triage.md when an LLM is used.
- README: architecture diagram (Mermaid), quick start, how each pipeline and agent works, configuration table,
  troubleshooting. docs/architecture.md with decisions and trade-offs. docs/LEARNING.md completed.
- A final self-review: list weaknesses, flaky risks, security concerns and the next 5 improvements.

Done when: every npm script works, all unit and Playwright tests pass 3× in a row, and a new teammate could
set up the project from the README alone.
```

---

## REVIEW PROMPT (paste after each phase)

```text
Review what you just built against the Master Prompt and this phase's "Done when" criteria.
1. Run lint, typecheck, unit tests and the relevant Playwright tests now and show me the real results.
2. List any rule from the Master Prompt that the new code breaks (raw locators in specs, waits, any,
   secrets, missing zod validation, missing tests, etc.) and fix them.
3. List anything you assumed instead of asking me.
4. Explain the 3 most important concepts from this phase as if teaching a Java/Serenity engineer.
Do not start the next phase.
```

## RECOVERY PROMPT (when the AI loops or goes off track)

```text
Stop. Do not write more code yet.
Summarise: what the task was, what you changed (files), what currently fails (exact error), and your
hypothesis for the root cause. Propose 2 options to fix it with trade-offs. Wait for my choice.
```

## SWITCH-TO-REAL-PROJECT PROMPT (after Phase 6 works on practice apps)

```text
We now switch TARGET=real for <FEATURE AREA, e.g. VOR case management>.
Do not change the framework core (fixtures, config, pipelines, integrations, ai/). Only add:
page objects, components, API clients, data builders and tests for this feature area.
First, ask me for: the main screens and their URLs, roles and how login works, key API endpoints,
test data rules, and 5 high-value scenarios. Then propose the page-object list and wait for approval.
```
