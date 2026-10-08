import { useState, type FormEvent, type ReactNode } from "react";
import type {
  Category,
  DashboardConfig,
  NewRunRequest,
  Release,
  RunProgress,
  RunResults,
  RunSummary,
  StepState,
  TrendPoint,
} from "../../shared/contracts";
import { newRunRequestSchema } from "../../shared/contracts";
import { ApiError } from "./api";
import { CATEGORY_LABEL, CATEGORY_ORDER, dateTime, duration, pct, STATE_LABEL } from "./format";

// ---- Generic states -------------------------------------------------------------

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" /> {label}…
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="state error" role="alert">
      <strong>Something went wrong.</strong> {error.message}
      {onRetry && (
        <button type="button" className="btn secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state empty">{children}</div>;
}

export function Card({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="card" aria-label={title}>
      <header className="card-head">
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

const ExternalLink = ({ href, children }: { href?: string; children: ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ) : null;

// ---- New run form -------------------------------------------------------------

export function NewRunForm({
  config,
  onStart,
}: {
  config: DashboardConfig;
  onStart: (req: NewRunRequest) => Promise<void>;
}) {
  const [releaseVersion, setRelease] = useState("");
  const [environment, setEnvironment] = useState<NewRunRequest["environment"]>("qa");
  const [grep, setGrep] = useState("@Regression");
  const [suites, setSuites] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(undefined);
    const parsed = newRunRequestSchema.safeParse({
      releaseVersion,
      environment,
      grep,
      suites: suites
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onStart(parsed.data);
    } catch (err) {
      setSubmitError(err instanceof ApiError || err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={(e) => void submit(e)} noValidate>
      <div className="field">
        <label htmlFor="release">Release version</label>
        <input
          id="release"
          name="release"
          placeholder="2026.10.1"
          value={releaseVersion}
          onChange={(e) => setRelease(e.target.value)}
          aria-invalid={!!errors.releaseVersion}
          aria-describedby={errors.releaseVersion ? "release-error" : "release-hint"}
          autoComplete="off"
          required
        />
        {errors.releaseVersion ? (
          <span id="release-error" className="field-error">
            {errors.releaseVersion}
          </span>
        ) : (
          <span id="release-hint" className="hint">
            Creates or reuses the Test Plan “Regression &lt;version&gt;”.
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="environment">Environment</label>
        <select
          id="environment"
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as NewRunRequest["environment"])}
        >
          {config.environments.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="grep">Test scope (tags / grep)</label>
        <input
          id="grep"
          value={grep}
          onChange={(e) => setGrep(e.target.value)}
          aria-invalid={!!errors.grep}
        />
        {errors.grep && <span className="field-error">{errors.grep}</span>}
      </div>
      <div className="field">
        <label htmlFor="suites">Suites (optional)</label>
        <input
          id="suites"
          placeholder="api/cart, ui/regression"
          value={suites}
          onChange={(e) => setSuites(e.target.value)}
        />
        <span className="hint">Comma-separated feature folders. Empty = all mapped suites.</span>
      </div>
      {submitError && (
        <div className="state error" role="alert">
          {submitError}
        </div>
      )}
      <button type="submit" className="btn" disabled={busy}>
        {busy ? "Starting…" : "Start regression run"}
      </button>
    </form>
  );
}

// ---- Progress -------------------------------------------------------------------

const StateBadge = ({ state }: { state: StepState }) => (
  <span className={`badge state-${state}`}>
    <span className="dot" aria-hidden="true" />
    {STATE_LABEL[state]}
  </span>
);

export function ProgressTimeline({ progress }: { progress: RunProgress }) {
  return (
    <div>
      <ol className="timeline" aria-label="Run progress" aria-live="polite">
        {progress.steps.map((step) => (
          <li key={step.id} className={`step state-${step.state}`} data-testid={`step-${step.id}`}>
            <span className="step-marker" aria-hidden="true" />
            <div className="step-body">
              <span className="step-label">{step.label}</span>
              {step.detail && <span className="step-detail">{step.detail}</span>}
            </div>
            <StateBadge state={step.state} />
          </li>
        ))}
      </ol>
      {progress.shards.length > 0 && (
        <div className="shards" aria-label="Shards">
          {progress.shards.map((s) => (
            <span key={s.name} className={`chip state-${s.state}`} title={STATE_LABEL[s.state]}>
              {s.name}: {STATE_LABEL[s.state]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Results ----------------------------------------------------------------------

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      className={`kpi ${tone ?? ""}`}
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

export function ResultsView({ results }: { results: RunResults }) {
  const [group, setGroup] = useState<"category" | "cluster">("category");
  const k = results.kpis;
  return (
    <div className="results">
      <div className="kpis">
        <Kpi label="Total" value={String(k.total)} />
        <Kpi label="Passed" value={String(k.passed)} tone="good" />
        <Kpi label="Failed" value={String(k.failed)} tone={k.failed ? "bad" : ""} />
        <Kpi label="Flaky" value={String(k.flaky)} tone={k.flaky ? "warn" : ""} />
        <Kpi label="Skipped" value={String(k.skipped)} />
        <Kpi
          label="Pass rate"
          value={pct(k.passRate)}
          tone={k.passRate >= 0.95 ? "good" : k.passRate >= 0.85 ? "warn" : "bad"}
        />
        <Kpi label="Duration" value={duration(k.durationMs)} />
      </div>

      <div className="links">
        <ExternalLink href={results.links.build}>Azure DevOps build</ExternalLink>
        <ExternalLink href={results.links.artifacts}>HTML report &amp; traces</ExternalLink>
        <ExternalLink href={results.links.testPlan}>Test Plan</ExternalLink>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Group failures by">
        <button
          type="button"
          role="radio"
          aria-checked={group === "category"}
          onClick={() => setGroup("category")}
        >
          By category
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={group === "cluster"}
          onClick={() => setGroup("cluster")}
        >
          By root cause
        </button>
      </div>

      {results.failures.length === 0 ? (
        <Empty>No failures in this run. 🎉</Empty>
      ) : group === "category" ? (
        CATEGORY_ORDER.filter((c) => results.totals[c] > 0).map((c) => (
          <CategoryGroup key={c} category={c} results={results} />
        ))
      ) : (
        <ul className="clusters">
          {results.clusters.map((c) => (
            <li key={c.signatureHash} className="cluster">
              <div className="cluster-head">
                <span className={`cat cat-${c.category}`}>{CATEGORY_LABEL[c.category]}</span>
                <strong>
                  {c.count} test{c.count > 1 ? "s" : ""}
                </strong>
                {c.isNew && <span className="chip">new</span>}
                {c.bugUrl && <ExternalLink href={c.bugUrl}>Bug #{c.bugId}</ExternalLink>}
              </div>
              <code className="error-line">{c.sampleError}</code>
              <p className="reason">{c.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryGroup({ category, results }: { category: Category; results: RunResults }) {
  const items = results.failures.filter((f) => f.category === category);
  const bugBySig = new Map(
    results.clusters.filter((c) => c.bugUrl).map((c) => [c.signatureHash, c]),
  );
  return (
    <details className="group" open={category !== "FLAKY"}>
      <summary>
        <span className={`cat cat-${category}`}>{CATEGORY_LABEL[category]}</span> {items.length}
      </summary>
      <ul className="failures">
        {items.map((f) => {
          const bug = bugBySig.get(f.signatureHash);
          return (
            <li key={`${f.file}-${f.title}-${f.project}`} className="failure">
              <div className="failure-title">
                {f.title} <span className="muted">· {f.project}</span>
                {f.isNew && <span className="chip">new</span>}
              </div>
              <code className="error-line">{f.errorSummary}</code>
              <p className="reason">
                {f.reason} <span className="muted">(confidence {f.confidence})</span>
              </p>
              <div className="links small">
                {f.testCaseUrl && (
                  <ExternalLink href={f.testCaseUrl}>Test Case {f.tcId}</ExternalLink>
                )}
                {bug && <ExternalLink href={bug.bugUrl}>Bug #{bug.bugId}</ExternalLink>}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

// ---- Trend ------------------------------------------------------------------------

export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return <Empty>No completed runs with triage results yet.</Empty>;
  const w = 640;
  const h = 200;
  const pad = 32;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, points.length - 1);
  const min = Math.min(0.8, ...points.map((p) => p.passRate));
  const y = (v: number) => h - pad - ((v - min) / (1 - min)) * (h - 2 * pad);
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.passRate).toFixed(1)}`)
    .join(" ");
  return (
    <div className="trend">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Pass rate over the last ${points.length} runs, from ${pct(points[0].passRate)} to ${pct(points[points.length - 1].passRate)}`}
      >
        {[min, (min + 1) / 2, 1].map((v) => (
          <g key={v}>
            <line x1={pad} x2={w - pad} y1={y(v)} y2={y(v)} className="gridline" />
            <text x={4} y={y(v) + 4} className="axis">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        <path d={line} className="trend-line" />
        {points.map((p, i) => (
          <circle key={p.runId} cx={x(i)} cy={y(p.passRate)} r={4} className="trend-dot">
            <title>{`${p.label}: ${pct(p.passRate)}, ${p.flaky} flaky, ${duration(p.durationMs)}`}</title>
          </circle>
        ))}
      </svg>
      <table className="table">
        <caption className="sr-only">Runs in the trend</caption>
        <thead>
          <tr>
            <th scope="col">Run</th>
            <th scope="col">Date</th>
            <th scope="col">Pass rate</th>
            <th scope="col">Failed</th>
            <th scope="col">Flaky</th>
            <th scope="col">Duration</th>
          </tr>
        </thead>
        <tbody>
          {[...points].reverse().map((p) => (
            <tr key={p.runId}>
              <td>{p.label}</td>
              <td>{dateTime(p.date)}</td>
              <td>{pct(p.passRate)}</td>
              <td>{p.failed}</td>
              <td>{p.flaky}</td>
              <td>{duration(p.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Run lists ----------------------------------------------------------------------

const STATUS_TONE: Record<RunSummary["status"], string> = {
  queued: "pending",
  running: "running",
  completed: "done",
  failed: "failed",
};

export function RunList({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) return <Empty>No runs yet. Start one above.</Empty>;
  return (
    <ul className="run-list">
      {runs.map((r) => (
        <li key={r.id}>
          <a href={`#/runs/${r.id}`} className="run-link">
            <span className="run-release">{r.releaseVersion}</span>
            <span className="muted">
              {r.environment} · {dateTime(r.createdAt)}
            </span>
            <span className={`badge state-${STATUS_TONE[r.status]}`}>
              <span className="dot" aria-hidden="true" />
              {r.status}
              {r.passRate !== undefined ? ` · ${pct(r.passRate)}` : ""}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ReleaseHistory({ releases }: { releases: Release[] }) {
  if (releases.length === 0) return <Empty>No releases yet.</Empty>;
  return (
    <table className="table">
      <caption className="sr-only">Release history</caption>
      <thead>
        <tr>
          <th scope="col">Release</th>
          <th scope="col">Test Plan</th>
          <th scope="col">Runs</th>
          <th scope="col">Latest outcome</th>
        </tr>
      </thead>
      <tbody>
        {releases.map((r) => (
          <tr key={r.releaseVersion}>
            <th scope="row">{r.releaseVersion}</th>
            <td>
              {r.planUrl ? <ExternalLink href={r.planUrl}>Plan {r.planId}</ExternalLink> : "—"}
            </td>
            <td>
              {r.runs.map((run, i) => (
                <span key={run.id}>
                  {i > 0 && ", "}
                  <a href={`#/runs/${run.id}`}>#{run.id}</a>
                </span>
              ))}
            </td>
            <td>{r.latestOutcome}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
