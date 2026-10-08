import type { DashboardConfig, NewRunRequest } from "../../shared/contracts";
import { api } from "./api";
import {
  Card,
  ErrorBox,
  Loading,
  NewRunForm,
  ProgressTimeline,
  ReleaseHistory,
  ResultsView,
  RunList,
  TrendChart,
} from "./components";
import { navigate, useAsync, useRoute } from "./hooks";

function Home({ config }: { config: DashboardConfig }) {
  const runs = useAsync(() => api.runs(), [], { pollSeconds: config.pollSeconds });
  async function start(req: NewRunRequest) {
    const run = await api.startRun(req);
    navigate(`/runs/${run.id}`);
  }
  return (
    <div className="grid two">
      <Card title="New regression run">
        <NewRunForm config={config} onStart={start} />
      </Card>
      <Card title="Recent runs">
        {runs.error && !runs.data ? (
          <ErrorBox error={runs.error} onRetry={runs.reload} />
        ) : runs.data ? (
          <RunList runs={runs.data} />
        ) : (
          <Loading />
        )}
      </Card>
    </div>
  );
}

function RunPage({ id, config }: { id: string; config: DashboardConfig }) {
  const progress = useAsync(() => api.progress(id), [id], { pollSeconds: config.pollSeconds });
  const done = progress.data?.done ?? false;
  const triaged =
    progress.data?.steps.some((s) => s.id === "triage" && s.state === "done") ?? false;
  const results = useAsync(() => api.results(id), [id, triaged], {
    pollSeconds: config.pollSeconds,
    active: !done,
  });
  const run = progress.data?.run;

  return (
    <div className="stack">
      <a href="#/" className="back">
        ← All runs
      </a>
      <Card
        title={run ? `Release ${run.releaseVersion} · ${run.environment}` : `Run ${id}`}
        actions={
          run?.buildUrl ? (
            <a href={run.buildUrl} target="_blank" rel="noreferrer noopener">
              Open in Azure DevOps
            </a>
          ) : undefined
        }
      >
        {progress.error && !progress.data ? (
          <ErrorBox error={progress.error} onRetry={progress.reload} />
        ) : progress.data ? (
          <ProgressTimeline progress={progress.data} />
        ) : (
          <Loading label="Loading progress" />
        )}
      </Card>
      <Card title="Results">
        {results.error && !results.data ? (
          <ErrorBox error={results.error} onRetry={results.reload} />
        ) : results.data ? (
          <ResultsView results={results.data} />
        ) : results.data === null ? (
          <div className="state empty" role="status">
            Results appear here once the run is triaged
            {done ? " (none were produced for this run)" : ""}.
          </div>
        ) : (
          <Loading label="Loading results" />
        )}
      </Card>
    </div>
  );
}

function TrendPage() {
  const trend = useAsync(() => api.trend(15), []);
  return (
    <Card title="Trend: last runs">
      {trend.error ? (
        <ErrorBox error={trend.error} onRetry={trend.reload} />
      ) : trend.data ? (
        <TrendChart points={trend.data} />
      ) : (
        <Loading />
      )}
    </Card>
  );
}

function ReleasesPage() {
  const releases = useAsync(() => api.releases(), []);
  return (
    <Card title="Release history">
      {releases.error ? (
        <ErrorBox error={releases.error} onRetry={releases.reload} />
      ) : releases.data ? (
        <ReleaseHistory releases={releases.data} />
      ) : (
        <Loading />
      )}
    </Card>
  );
}

export function App() {
  const route = useRoute();
  const config = useAsync(() => api.config(), []);
  const tab = route[0] ?? "";
  const nav = [
    ["", "Runs"],
    ["trend", "Trend"],
    ["releases", "Releases"],
  ] as const;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ✓
          </span>{" "}
          Release Dashboard
        </div>
        <nav aria-label="Main">
          {nav.map(([path, label]) => (
            <a
              key={path}
              href={`#/${path}`}
              aria-current={tab === path || (path === "" && tab === "runs") ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        {config.data?.mock && (
          <span className="chip mock" title="DASHBOARD_MOCK=true: no Azure DevOps calls">
            Mock data
          </span>
        )}
      </header>
      <main className="container">
        {config.error ? (
          <ErrorBox error={config.error} onRetry={config.reload} />
        ) : !config.data ? (
          <Loading />
        ) : tab === "runs" && route[1] ? (
          <RunPage id={route[1]} config={config.data} />
        ) : tab === "trend" ? (
          <TrendPage />
        ) : tab === "releases" ? (
          <ReleasesPage />
        ) : (
          <Home config={config.data} />
        )}
      </main>
    </>
  );
}
