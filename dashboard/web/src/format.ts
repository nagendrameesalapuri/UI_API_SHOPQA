import type { Category, StepState } from "../../shared/contracts";

export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export const CATEGORY_LABEL: Record<Category, string> = {
  PRODUCT_BUG: "Product bug",
  ENVIRONMENT: "Environment",
  TEST_ISSUE: "Test issue",
  FLAKY: "Flaky",
  UNKNOWN: "Needs a human",
};

export const CATEGORY_ORDER: Category[] = [
  "PRODUCT_BUG",
  "ENVIRONMENT",
  "TEST_ISSUE",
  "FLAKY",
  "UNKNOWN",
];

export const STATE_LABEL: Record<StepState, string> = {
  pending: "Waiting",
  running: "In progress",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};
