import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Audit trail for every agent action (reports/agent-audit.jsonl): who did what, with
// which inputs (hashed, never raw), and the outcome. Reviewers can reconstruct exactly
// what an agent created (branches, PRs, bug drafts) without trusting its summary.

export type AuditEntry = {
  agent: string;
  action: string;
  inputs?: unknown;
  outcome: "ok" | "skipped" | "failed" | "dry-run";
  details?: Record<string, unknown>;
};

export const DEFAULT_AUDIT_FILE = path.join("reports", "agent-audit.jsonl");

export function hashInputs(inputs: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(inputs ?? null))
    .digest("hex")
    .slice(0, 16);
}

export function audit(
  entry: AuditEntry,
  file = process.env.AGENT_AUDIT_FILE ?? DEFAULT_AUDIT_FILE,
): void {
  const line = {
    ts: new Date().toISOString(),
    agent: entry.agent,
    action: entry.action,
    inputsHash: hashInputs(entry.inputs),
    outcome: entry.outcome,
    ...(entry.details ? { details: entry.details } : {}),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(line) + "\n");
}
