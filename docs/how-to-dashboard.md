# How to run and host the Release Dashboard

`dashboard/server` (Express 5) + `dashboard/web` (React 19 + Vite) + `dashboard/shared/contracts.ts`
(zod contracts used by both). No database.

## Demo without Azure DevOps

```bash
DASHBOARD_MOCK=true npm run dashboard:dev          # bash
$env:DASHBOARD_MOCK="true"; npm run dashboard:dev  # PowerShell
```

Open http://localhost:4300 → enter `2026.10.1` → **Start regression run**. The mock pipeline moves
through _Plan created → Pipeline queued → Running (4 shards) → Reports merged → Failures triaged →
Results published_ (12 s per stage; `DASHBOARD_MOCK_STEP_SECONDS` to change), then shows KPIs and
failures grouped by category or root cause, with links. _Trend_ and _Releases_ have sample data.

## Against real Azure DevOps

`.env` (server only — the browser never sees the PAT):

```
ADO_ORG=my-org
ADO_PROJECT=AYCC
ADO_PAT=...                       # scopes: see docs/how-to-ado.md
ADO_REGRESSION_PIPELINE_ID=42
DASHBOARD_USER=qa
DASHBOARD_PASSWORD=<strong password>
# optional: DASHBOARD_PIPELINE_BRANCH=main, ADO_AREA_PATH, ADO_ITERATION_PATH, DASHBOARD_POLL_SECONDS=15
```

```bash
npm run dashboard:build && npm run dashboard:start
```

Run `npm run ado:map-tests` first so new plans get suites and Test Cases (`data/tc-mapping.json`).

What happens on **Start**: create/reuse plan _Regression &lt;version&gt;_ → ensure suites → add mapped Test
Cases (only the suites you list, if any) → queue `regression.yml` with `releaseVersion`, `testPlanId`,
`environment`, `grep`. The page polls every 15 s: pipeline state + build timeline → steps and shards;
after triage it reads `ai-triage.json` from the run's artifact.

## Data and caching

- Source of truth: Azure DevOps (plans, runs, timelines, artifacts).
- `dashboard/.cache/*.json` (`JsonFileStore`): live data cached 10–60 s; triage reports of completed
  runs cached without expiry; the list _release → plan → pipeline run_ for runs started from the
  dashboard. Deleting the folder is safe.
- To move to a database later, implement `Store` (`integrations/store/store.ts`) — no other changes.

## Access control

- Basic auth (`DASHBOARD_USER`/`DASHBOARD_PASSWORD`); real mode refuses to start without it.
  `/api/health` stays open for probes.
- Production recommendation: put it behind **Microsoft Entra ID** with _App Service Authentication
  (Easy Auth)_ — no code change; keep basic auth as a second factor or remove it once Easy Auth is on.
  For in-app Entra sign-in, replace `basicAuth` in `app.ts` with an MSAL/OIDC middleware (placeholder).

## Hosting options

| Option                                             | Steps                                                                                                                                                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Azure App Service (Linux, Node 20)**             | `npm ci && npm run dashboard:build`; startup command `npx tsx dashboard/server/main.ts`; app settings = the variables above (PAT from Key Vault reference `@Microsoft.KeyVault(...)`); enable Easy Auth                             |
| **Container (App Service / Container Apps / AKS)** | Image from `node:20-slim` copying the repo, `npm ci`, `npm run dashboard:build`, `CMD ["npx","tsx","dashboard/server/main.ts"]`, `EXPOSE 4300`; mount `/app/dashboard/.cache` on a volume if you want the cache to survive restarts |
| **Internal VM**                                    | Same commands under a process manager (pm2/systemd) behind a reverse proxy with TLS                                                                                                                                                 |

Scale-out note: the cache is per instance; with several instances use a shared Store implementation.

## Tests

- `npm run test:dashboard` — Playwright UI tests (`tests/ui/dashboard`, desktop + mobile, a11y checks),
  backend mocked with `page.route`; builds and serves the app with `vite preview` automatically.
- `npm run unit` — server routes, auth, timeline mapping, ADO service with mocked HTTP.
