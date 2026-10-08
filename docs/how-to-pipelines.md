# How to set up the Azure Pipelines

All YAML lives in `.azuredevops/pipelines/`:

| File                              | Trigger                                                     | What it does                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pr-validation.yml`               | PRs to `main`                                               | Lint, typecheck, unit tests, triage eval, dashboard UI tests ∥ smoke tests (`@Sanity`) on chromium + API                          |
| `regression.yml`                  | Nightly 20:30 UTC (02:00 IST), Mon–Fri + manual + dashboard | Sharded `@Regression` → merged report → triage → publish to Test Plan                                                             |
| `release-run.yml`                 | Manual                                                      | Same stages; `releaseVersion` required; plan "Regression &lt;version&gt;" created/reused                                          |
| `ai-story-to-test.yml`            | Manual (`storyId`)                                          | Story-to-Test agent → draft PR                                                                                                    |
| `templates/install-steps.yml`     | —                                                           | Node 20, npm cache, `npm ci`, optional browsers (skipped in container jobs)                                                       |
| `templates/test-job.yml`          | —                                                           | `strategy.parallel = shards`, `--shard=$(System.JobPositionInPhase)/$(System.TotalJobsInPhase)`, JUnit + blob artifact `blob-<n>` |
| `templates/report-steps.yml`      | —                                                           | Downloads `blob-*`, `merge-reports --reporter html,json`, publishes `html-report` + `results-json`                                |
| `templates/regression-stages.yml` | —                                                           | Test → Report → Triage → Publish (Report and later run with `condition: always()`)                                                |

## 1. Variable groups (one per environment)

Create in **Pipelines → Library → + Variable group**. Naming convention: `playwright-<env>` (`playwright-dev`,
`playwright-qa`, `playwright-uat`) plus `playwright-ai` for the AI settings.

| Group                         | Variable                                                                                                                                      | Secret?        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `playwright-<env>`            | `UI_TEST_ADMIN_EMAIL`, `UI_TEST_ADMIN_PASSWORD`, `UI_TEST_CUSTOMER_EMAIL`, `UI_TEST_CUSTOMER_PASSWORD`, `API_TEST_EMAIL`, `API_TEST_PASSWORD` | passwords: yes |
| `playwright-<env>` (optional) | `UI_BASE_URL`, `API_BASE_URL` (override `src/config/environments/<env>.env`)                                                                  | no             |
| `playwright-ai`               | `LLM_PROVIDER` (`none` until an LLM is approved), provider keys (`ANTHROPIC_API_KEY`, `AZURE_OPENAI_API_KEY`, …)                              | keys: yes      |

**Link to Key Vault (recommended):** in the variable group, enable _Link secrets from an Azure key vault
as variables_, choose the service connection and vault, then **+ Add** the secrets. Secret names in Key
Vault cannot contain `_`, so name them e.g. `UI-TEST-ADMIN-PASSWORD` and map them in `test-job.yml`
(`UI_TEST_ADMIN_PASSWORD: $(UI-TEST-ADMIN-PASSWORD)`).

Secrets are **not** visible to scripts unless mapped with `env:` — `test-job.yml` maps each one explicitly.
Never put a secret in YAML.

On first run each pipeline asks to **Permit** access to the variable group: approve it once.

## 2. Create the pipelines

For each YAML file: **Pipelines → New pipeline → (Azure Repos Git | GitHub) → your repo → Existing Azure
Pipelines YAML file → choose the file → Save** (not Run). Rename them: _PR validation_, _Regression_,
_Release run_, _AI story to test_.

- Azure Repos: add _PR validation_ as a **Build validation** policy on `main` (Repos → Branches → main →
  Branch policies). Azure Repos ignores the `pr:` keyword.
- GitHub repo: the `pr:` trigger in `pr-validation.yml` is used as-is.
- Note the **pipeline id** of _Regression_ (in its URL `definitionId=…`) and set it as
  `ADO_REGRESSION_PIPELINE_ID` for the dashboard.

## 3. Permissions for the build service

The pipelines use `$(System.AccessToken)` — the identity _&lt;Project&gt; Build Service (&lt;org&gt;)_. Grant it:

| Where                                                                                              | Permission                                                                      | Needed by                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| Project settings → Test → _Test plans / test suites_ (or Test Plans → plan security)               | _Manage test plans_, _Manage test suites_, _Create test runs_, _View test runs_ | Publish stage, release plans        |
| Project settings → Permissions → Build Service                                                     | _Create test runs_, _View work items in this node_                              | Publish, triage                     |
| Boards → Area path security (Project settings → Boards → Project configuration → Areas → Security) | _Edit work items in this node_, _View work items in this node_                  | Draft bugs, Test Cases              |
| Repos → Security → Build Service                                                                   | _Contribute_, _Create branch_, _Contribute to pull requests_                    | Story-to-test, healer PRs           |
| Pipelines → _Regression_ → Security                                                                | _View builds_                                                                   | Triage history (previous artifacts) |

Also check **Project settings → Pipelines → Settings**: if _Limit job authorization scope to current
project_ is on, the identity is project-scoped (fine). If _Protect access to repositories in YAML pipelines_
is on, repository access must be granted per pipeline.

## 4. Validate the YAML

- In the pipeline editor (**Edit**), click **⋮ → Validate** (or **Validate and save**): it expands
  templates and reports errors without running.
- **Run pipeline → (choose parameters) → Advanced options → Preview** shows the fully expanded YAML.
- REST alternative: `POST {org}/{project}/_apis/pipelines/{id}/preview?api-version=7.1` with
  `{"previewRun": true}` returns the final YAML.
- Locally we only check syntax (`node -e "require('yaml').parse(...)"`); template expressions are
  evaluated by Azure DevOps only.

## 5. Running

- Manual regression: _Regression → Run pipeline_, set `environment`, `grep`, `shards`; leave
  `releaseVersion`/`testPlanId` empty for a plain run.
- Release sign-off: _Release run_ with `releaseVersion=2026.10.1` (or the dashboard).
- Container mode: set `runInContainer=true` to run inside `mcr.microsoft.com/playwright:v1.63.0-noble`
  (same image as the Dockerfile; keep both versions equal to `@playwright/test`).

## Outputs per run

Artifacts: `blob-1..N`, `html-report` (open `index.html`), `results-json`, `ai-triage`
(`ai-triage.json`, `ai-triage.md`, `triage-history.json`, `agent-audit.jsonl`). The triage summary is
attached to the run's **Extensions** tab (`##vso[task.uploadsummary]`). JUnit results appear in **Tests**.
