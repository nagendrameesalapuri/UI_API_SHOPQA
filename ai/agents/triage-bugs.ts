import type { AdoClient } from "../../integrations/ado/ado-client";
import {
  createBugDraft,
  findOpenBugsWithSignature,
  workItemWebUrl,
} from "../../integrations/ado/work-items";
import { audit } from "../core/audit";
import type { Redactor } from "../core/redact";
import type { TriageReport } from "./triage-schema";

// --create-bugs: DRAFT bugs only for PRODUCT_BUG clusters with confidence >= 0.8 that are
// not already tracked by an open ai-triage bug with the same signature. Bugs stay in the
// default state, tagged ai-triage + needs-review, for a human to accept or close.

export const BUG_CONFIDENCE = 0.8;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function createBugsForReport(
  client: AdoClient,
  report: TriageReport,
  redactor: Redactor,
  opts: { dryRun?: boolean } = {},
): Promise<{ created: number[]; skipped: { signatureHash: string; reason: string }[] }> {
  const created: number[] = [];
  const skipped: { signatureHash: string; reason: string }[] = [];

  for (const cluster of report.clusters) {
    if (cluster.category !== "PRODUCT_BUG" || cluster.confidence < BUG_CONFIDENCE) continue;

    const existing = await findOpenBugsWithSignature(client, cluster.signatureHash);
    if (existing.length) {
      cluster.bugId = existing[0];
      cluster.bugUrl = workItemWebUrl(client, existing[0]);
      skipped.push({
        signatureHash: cluster.signatureHash,
        reason: `already tracked by bug ${existing[0]}`,
      });
      audit({
        agent: "triage",
        action: "create-bug",
        inputs: cluster.signatureHash,
        outcome: "skipped",
        details: { existing: existing[0] },
      });
      continue;
    }

    const items = report.items.filter((i) => i.signatureHash === cluster.signatureHash);
    const first = items[0];
    const title = `[AI triage] ${redactor.redact(cluster.sampleError).text.slice(0, 180)} [sig:${cluster.signatureHash}]`;
    const repro = [
      `<p><b>Suggested by the automated triage</b> (confidence ${cluster.confidence}). Needs human review.</p>`,
      `<p><b>Reason:</b> ${escapeHtml(cluster.reason)}</p>`,
      `<p><b>Affected tests (${cluster.count}):</b></p><ul>${cluster.tests.map((t) => `<li>${escapeHtml(t.title)} (${t.project})</li>`).join("")}</ul>`,
      first?.failingStep ? `<p><b>Failing step:</b> ${escapeHtml(first.failingStep)}</p>` : "",
      `<p><b>Error:</b></p><pre>${escapeHtml(redactor.redact(first?.errorMessage ?? cluster.sampleError).text.slice(0, 3000))}</pre>`,
      report.run.buildUrl
        ? `<p>Build, HTML report and traces: <a href="${report.run.buildUrl}">${report.run.buildUrl}</a></p>`
        : "",
    ].join("");

    const tcIds = [...new Set(cluster.tests.flatMap((t) => (t.tcId ? [t.tcId] : [])))];
    if (opts.dryRun) {
      audit({
        agent: "triage",
        action: "create-bug",
        inputs: cluster.signatureHash,
        outcome: "dry-run",
        details: { title },
      });
      continue;
    }
    const bug = await createBugDraft(client, {
      title,
      repro,
      severity: "2 - High",
      tags: ["regression"],
      links: report.run.buildUrl
        ? [{ url: report.run.buildUrl, comment: "Pipeline run with report and traces" }]
        : [],
      relatedWorkItemIds: tcIds,
    });
    cluster.bugId = bug.id;
    cluster.bugUrl = workItemWebUrl(client, bug.id);
    created.push(bug.id);
    audit({
      agent: "triage",
      action: "create-bug",
      inputs: cluster.signatureHash,
      outcome: "ok",
      details: { bugId: bug.id },
    });
  }
  return { created, skipped };
}
