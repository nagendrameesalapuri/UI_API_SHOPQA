# How to use the Azure DevOps integration

Code: `integrations/ado/` (REST API **7.1**, zod-validated, retries on 429/5xx honouring `Retry-After`).
Unit tests mock every HTTP call (`npm run unit`).

## Authentication

| Where                        | Token                                            | Configure                                                                                                                            |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Pipelines                    | `$(System.AccessToken)` (build service identity) | `env: SYSTEM_ACCESSTOKEN: $(System.AccessToken)`; org/project come from the predefined `SYSTEM_COLLECTIONURI` / `SYSTEM_TEAMPROJECT` |
| Local CLIs, dashboard server | Personal Access Token                            | `.env`: `ADO_ORG`, `ADO_PROJECT`, `ADO_PAT`, `ADO_REPO`                                                                              |

### PAT scopes

Create at _User settings → Personal access tokens → New token_ (custom defined scopes, shortest
sensible expiry):

| Scope               | Access         | Used for                                       |
| ------------------- | -------------- | ---------------------------------------------- |
| **Test Management** | Read & write   | Plans, suites, test points, test runs/results  |
| **Work Items**      | Read & write   | Stories, Test Cases, draft bugs, WIQL          |
| **Build**           | Read & execute | Queue/read pipeline runs, timelines, artifacts |
| **Code**            | Read & write   | Agent branches and pull requests               |

Keep the PAT only in `.env` (gitignored) or the dashboard host's app settings / Key Vault.

## Mapping tests to Test Cases

A Playwright test is linked to an Azure Test Case by, in order:

1. A tag in the title: `test("@Regression @TC-12345 Apply coupon", ...)`
2. An annotation: `test("...", { annotation: { type: "TC", description: "12345" } }, ...)`
3. `data/tc-overrides.json` — no title change needed:
   ```json
   { "ui/regression/CouponTests.spec.ts > Coupon Tests > @Regression TC-021 Apply FLAT500": 12345 }
   ```
   The key is `file > describe > title` exactly as printed by `npm run ado:map-tests`.

The local labels already in titles (e.g. `TC-003`) are **not** Azure ids and are ignored unless written
as tags.

```bash
npm run ado:map-tests                 # writes data/tc-mapping.json, lists unmapped tests
npm run ado:map-tests -- --plan 321   # also lists plan Test Cases without an automated test
```

## Test Plans

```bash
npm run ado:create-plan -- --release 2026.10 [--area "Proj\\QA"] [--iteration "Proj\\Sprint 42"]
```

Creates (or reuses — idempotent) the plan **Regression 2026.10**, one static suite per feature folder
(`api/cart`, `ui/regression`, …) and adds the mapped Test Cases. `ensureSuites` also supports
query-based suites (`testCasesTaggedWiql("smoke")`).

## Publishing results

```bash
npm run ado:publish-results -- --plan 321            # or --release 2026.10
```

Creates an automated test run for the plan's test points, PATCHes every result (outcome, duration,
error, stack, a comment with the project/retries and a link to the build artifacts), uploads the failure
screenshot when it is on disk, then completes the run (also when an update fails). When one Test Case
is covered by several tests/browsers, the worst outcome wins. Flaky = Passed with a comment.

In `regression.yml` the Publish stage runs automatically when `testPlanId` or `releaseVersion` is set.

## Work items

- `getWorkItem(id)` returns fields + relations (`TestedBy-Forward` = linked Test Cases).
- `createBugDraft(...)` uses JSON-Patch on `$Bug`, always tags `ai-triage; needs-review`, never sets a
  state. Used by `npm run triage -- --create-bugs` only for PRODUCT_BUG clusters with confidence ≥ 0.8
  that do not already have an open bug with the same `[sig:<hash>]` in the title.
- `createTestCase(...)` writes steps XML and links the story (`TestedBy-Reverse`).

## Pipelines and artifacts

`queueRun(pipelineId, templateParameters, branch)`, `getRun`, `listRuns`, `getTimeline` (stages/jobs
for the dashboard), `listArtifacts`, `downloadArtifact` (zip, unpacked in memory with `fflate`),
`readArtifactJson` (used for triage history and the dashboard).

## Repos (agents)

`commitToBranch` creates `ai/...` branches with one commit through the Pushes API (no local git), and
`createPullRequest` opens a **draft** PR with labels and linked work items. If an active PR exists for
the branch it is reused. Nothing ever merges.
