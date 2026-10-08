# LEARNING.md — concepts in this framework, for a Java / Serenity / Selenide engineer

Short explanations with Java comparisons. Each section points at the file where the concept is used.

## TypeScript basics

| TypeScript                                      | Java equivalent                                                        | Where                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| `type User = { email: string }` / `interface`   | A record / POJO interface — types disappear at runtime (no reflection) | everywhere                               |
| `z.object({...})` + `z.infer<typeof schema>`    | Bean Validation + Jackson in one: validates **and** gives the type     | `api/schemas`, `src/config/env.ts`       |
| `string \| undefined`, `?.`, `??`               | `Optional<String>`, `.map()`, `.orElse()`                              | everywhere                               |
| `async`/`await`, `Promise<T>`                   | `CompletableFuture<T>` with `.join()` written like blocking code       | every page action                        |
| **Forgetting `await`**                          | Firing a future and never joining it — the step runs "later"           | ESLint `no-floating-promises` catches it |
| `import { x } from "./file"`                    | `import` + the file is the module (no packages/classes needed)         | everywhere                               |
| `export const test = base.extend<{...}>({...})` | A JUnit 5 extension / Spring bean factory                              | `fixtures/*.ts`                          |
| Discriminated union `"a" \| "b"`                | An enum, but checked by the compiler in `switch`                       | `TriageCategory`                         |
| `Record<string, number>`                        | `Map<String, Integer>`                                                 | many                                     |
| `strict: true` in tsconfig                      | Compiler warnings as errors + null-safety                              | `tsconfig.json`                          |
| Path aliases `@src/*`                           | Source roots / package prefixes                                        | `tsconfig.json`                          |

## Playwright vs Serenity/Selenide

- **Fixtures** (`test.extend`) replace `@Before` + `@Steps` injection: a test _asks_ for `cartPage` or
  `verifiedUser` in its parameters and Playwright builds it (and tears it down) for that test only.
  Fixtures can depend on other fixtures (`accessToken` needs `verifiedUser`). → `fixtures/data.fixture.ts`
- **`mergeTests`** combines fixture sets like composing several step libraries. → `src/fixtures/index.ts`
- **Web-first assertions**: `await expect(locator).toHaveText("x")` retries until timeout — like
  Selenide's `shouldHave(text("x"))`. Never `Thread.sleep` (= `waitForTimeout`).
- **Locators are lazy** like `SelenideElement`: nothing is searched until an action/assertion.
- **`test.step`** = Serenity `@Step`: named blocks in the HTML report and trace.
- **storageState** = saving the logged-in browser (cookies + localStorage) once and reusing it — a
  faster `@BeforeAll` login. → `tests/setup/auth.setup.ts`, `asRole()` fixture
- **Projects** = Maven profiles/Serenity environments in one run (setup, chromium, firefox, api, e2e).
- **Trace viewer** (`npx playwright show-trace trace.zip`) = Serenity report + screenshots + network +
  DOM snapshots per step. Recorded on first retry.
- **Sharding** (`--shard=2/4`) splits tests across machines; **blob reports** are merged afterwards.

## API testing

- `request` fixture = RestAssured's `given()`; `RequestHandler` is a fluent builder like RestAssured's DSL.
- zod schemas = JSON-schema validation in RestAssured, but the schema is also the TypeScript type.
- `BaseClient` (src/api/base.client.ts) puts status check, schema validation and masked logging in
  one place, like a Feign client with an error decoder.

## Quality gates

- ESLint = Checkstyle/SpotBugs; Prettier = auto-formatter; Husky pre-commit = a git hook that runs
  lint-staged (lint + format staged files) and the typecheck before every commit.
- Vitest = JUnit for plain TypeScript (no browser). `vi.fn()` = Mockito; we inject a fake `fetch`
  instead of mocking HTTP libraries (`integrations/test-utils/mock-fetch.ts` ≈ WireMock in-process).

## Azure DevOps

- Pipelines YAML with **templates** = shared Jenkins library functions; **parameters** are compile-time
  (`${{ }}`), **variables** are run-time (`$( )`).
- **Variable groups** linked to Key Vault = credentials store; secrets must be mapped into `env:`.
- `System.AccessToken` = the pipeline's own identity; permissions are granted to _Build Service_.
- Test Plans: _plan → suites → Test Cases_; a **test point** is "this Test Case in this configuration in
  this suite". Automated results are recorded against test points through a _test run_.

## AI agents without an LLM

- **Rules first**: an ordered table of regexes (like a chain of responsibility) classifies failures.
  Deterministic, testable, explainable (`ruleId` + `reason`).
- **Error signature** = error text with ids/numbers/timestamps removed → one root cause, one cluster.
- **Golden set evaluation** = a regression test for the classifier: 23 known failures with expected
  categories; accuracy must stay ≥ 90%.
- **LLM as an optional second opinion**: behind an interface (`LlmProvider`) with a Null Object
  (`NoneProvider`) — the Strategy pattern. Every answer is schema-validated; failures fall back to rules.
- **Guardrails, redaction, cost log, audit log**: limits, privacy, money and traceability around any
  AI call or agent action.

## Dashboard

- Express = a tiny Spring MVC; `createApp()` takes its dependencies as parameters (constructor
  injection), so tests start it on a random port with a mock service.
- React components are functions returning markup; `useState`/`useEffect` hold state and side effects.
  Polling is a `setInterval` in a hook.
- Shared zod contracts = an OpenAPI model used by both client and server.
