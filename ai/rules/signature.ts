import crypto from "node:crypto";

// Error signature = the error message with everything run-specific removed (ids, numbers,
// timestamps, emails, URLs' hosts, durations). Failures with the same signature are one
// root cause, so 30 tests failing on "backend 503" become ONE cluster in the report.

const REPLACEMENTS: [RegExp, string][] = [
  [/\x1b\[[0-9;]*m/g, ""], // eslint-disable-line no-control-regex
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?\b/g, "<ts>"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<email>"],
  [/https?:\/\/[^/\s"']+/g, "<host>"],
  [/\b[0-9a-f]{12,}\b/gi, "<hex>"],
  [/\b\d+(\.\d+)?\s?(ms|s)\b/g, "<dur>"],
  [/\d+/g, "<n>"],
  [/[ \t]+/g, " "],
];

/** First meaningful lines of the error, normalised. */
export function normalizeError(message: string | undefined, maxLines = 4): string {
  if (!message) return "<no error message>";
  const lines = message
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^Call log:?$/i.test(l) && !/^\s*-\s/.test(l) && !/^at /.test(l))
    .slice(0, maxLines);
  let out = lines.join(" | ");
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  return out.slice(0, 300).trim();
}

export function signatureHash(signature: string): string {
  return crypto.createHash("sha1").update(signature).digest("hex").slice(0, 8);
}
