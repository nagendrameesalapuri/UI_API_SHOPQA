// Deterministic failure classifier. Used on its own with LLM_PROVIDER=none, and as the
// first pass (and fallback) when an LLM is configured.
//
// HOW TO ADD A PATTERN: add one row to RULES. Rows are evaluated top to bottom and the
// first match wins, so put specific rules above generic ones. No logic changes needed.

export type TriageCategory = "PRODUCT_BUG" | "TEST_ISSUE" | "ENVIRONMENT" | "FLAKY" | "UNKNOWN";

/** The minimum a rule needs to look at (a subset of NormalizedTest). */
export type FailureInput = {
  status: "failed" | "flaky" | "timedOut" | "passed" | "skipped" | "interrupted";
  errorMessage?: string;
  stack?: string;
  failingStep?: string;
  retries?: number;
};

export type RuleResult = {
  category: TriageCategory;
  /** Sub-type shown in reports, e.g. "locator", "data", "auth" */
  kind: string;
  confidence: number;
  reason: string;
  ruleId: string;
};

export type TriageRule = {
  id: string;
  category: TriageCategory;
  kind: string;
  confidence: number;
  reason: string;
  /** Regexes tested against "errorMessage + stack"; any match = rule matches */
  anyOf?: RegExp[];
  /** All of these must also NOT match */
  noneOf?: RegExp[];
  /** Extra condition on the failure (status, retries, ...) */
  when?: (f: FailureInput) => boolean;
};

// HTTP status as seen in our clients/assertions: "Status: 503", "-> 503", "Received: 503", "HTTP 503"
const status = (codes: string) =>
  new RegExp(`(Status:?\\s*|->\\s*|Received:\\s*|HTTP\\s+|status code\\s+)(${codes})\\b`, "i");

export const RULES: TriageRule[] = [
  {
    id: "flaky-passed-on-retry",
    category: "FLAKY",
    kind: "retry",
    confidence: 0.9,
    reason: "Failed first, then passed on retry (Playwright status 'flaky').",
    when: (f) => f.status === "flaky",
  },
  {
    id: "env-network",
    category: "ENVIRONMENT",
    kind: "network",
    confidence: 0.9,
    reason: "Network-level error: the app or backend could not be reached.",
    anyOf: [
      /net::ERR_[A-Z_]+/,
      /\bECONNREFUSED\b/,
      /\bENOTFOUND\b/,
      /\bECONNRESET\b/,
      /\bEAI_AGAIN\b/,
      /socket hang up/i,
      /getaddrinfo/i,
    ],
  },
  {
    // Seen on the real ShopQA API: invalid input answered with 500 + a raw PostgreSQL error
    // while the test expected a 4xx. The backend is up; it is missing input validation.
    id: "product-unhandled-db-error",
    category: "PRODUCT_BUG",
    kind: "validation",
    confidence: 0.8,
    reason:
      "Invalid input caused a 500 with a raw database error instead of a 4xx validation error: missing validation in the API.",
    anyOf: [
      /violates (unique|not-null|foreign key|check) constraint/i,
      /null value in column/i,
      /invalid input (value|syntax) for/i,
      /"code":\s*"(23\d{3}|22P02)"/,
    ],
    when: (f) => /Expected:\s*4\d\d\b/.test(f.errorMessage ?? ""),
  },
  {
    id: "env-backend-5xx",
    category: "ENVIRONMENT",
    kind: "backend",
    confidence: 0.85,
    reason: "Backend answered with a 5xx / gateway error.",
    anyOf: [
      status("5\\d\\d"),
      /\b(Bad Gateway|Service Unavailable|Gateway Time-?out|Internal Server Error)\b/i,
      /upstream (connect|request) timeout/i,
    ],
  },
  {
    id: "env-auth",
    category: "ENVIRONMENT",
    kind: "auth",
    confidence: 0.75,
    reason:
      "Authentication/authorisation failed (401/403, expired or rejected token): usually credentials or environment config.",
    anyOf: [
      status("401|403"),
      /\b(TOKEN_EXPIRED|jwt expired|token (has )?expired|invalid token)\b/i,
      /must be configured in \.env/i,
      /Invalid or missing environment variables/,
    ],
    // A test that *expects* 401/403 and gets something else is not an auth problem
    noneOf: [/Expected:\s*40[13]\b/],
  },
  {
    id: "env-redirected-to-login",
    category: "ENVIRONMENT",
    kind: "auth",
    confidence: 0.7,
    reason: "The login page appeared unexpectedly: the session or stored auth state is invalid.",
    anyOf: [/Received (string|value):\s*"?[^\n]*\/login/i],
    noneOf: [/Expected (string|pattern|value):\s*"?[^\n]*\/login/i],
  },
  {
    id: "data-conflict",
    category: "TEST_ISSUE",
    kind: "data",
    confidence: 0.75,
    reason:
      "Test data conflict (409 / duplicate / already exists): data is shared or not cleaned up.",
    anyOf: [
      status("409"),
      /\balready exists\b/i,
      /\bduplicate\b/i,
      /\b[A-Z_]*TAKEN\b/,
      /unique constraint/i,
    ],
    noneOf: [/Expected:\s*409\b/],
  },
  {
    id: "locator-strict-mode",
    category: "TEST_ISSUE",
    kind: "locator",
    confidence: 0.85,
    reason:
      "Locator matched several elements (strict mode violation): the locator is not specific enough.",
    anyOf: [/strict mode violation/i],
  },
  {
    id: "locator-not-found",
    category: "TEST_ISSUE",
    kind: "locator",
    confidence: 0.75,
    reason: "Element never appeared: the locator is probably stale after a UI change.",
    anyOf: [
      /resolved to 0 elements/i,
      /element\(s\) not found/i,
      /locator\.\w+: Timeout \d+ms exceeded[\s\S]*waiting for (getBy|locator\()/i,
    ],
    // If the element WAS found, the problem is its value/state, not the locator
    noneOf: [/locator resolved to </i],
  },
  {
    id: "contract-schema",
    category: "PRODUCT_BUG",
    kind: "contract",
    confidence: 0.65,
    reason: "API response does not match the expected schema: a possible contract change.",
    anyOf: [
      /ZodError/,
      /does not match schema/i,
      /"code":\s*"invalid_type"/,
      /expected \w+, received \w+/i,
    ],
  },
  {
    id: "assertion-value-mismatch",
    category: "PRODUCT_BUG",
    kind: "assertion",
    confidence: 0.6,
    reason:
      "A business value differs from the expected one (Expected X, Received Y) while the element/response was present.",
    // Second pattern: negated assertions (expect(x).not.toBe(y)) print only "Expected: not y"
    anyOf: [/Expected[^:\n]*:[^\n]+\n\s*Received[^:\n]*:/, /Expected[^:\n]*:\s*not\s/],
  },
  {
    id: "test-timeout",
    category: "TEST_ISSUE",
    kind: "timeout",
    confidence: 0.45,
    reason:
      "The whole test timed out without a more specific error: slow environment or a wait that never resolves.",
    when: (f) => f.status === "timedOut",
  },
];

export const FALLBACK: RuleResult = {
  category: "UNKNOWN",
  kind: "unclassified",
  confidence: 0.2,
  reason: "No rule matched; needs a human (or the LLM, when configured).",
  ruleId: "fallback",
};

export function classify(f: FailureInput, rules: TriageRule[] = RULES): RuleResult {
  const text = `${f.errorMessage ?? ""}\n${f.stack ?? ""}`;
  for (const rule of rules) {
    if (rule.when && !rule.when(f)) continue;
    if (rule.anyOf && !rule.anyOf.some((r) => r.test(text))) continue;
    if (rule.noneOf?.some((r) => r.test(text))) continue;
    if (!rule.when && !rule.anyOf) continue; // a rule must have at least one condition
    return {
      category: rule.category,
      kind: rule.kind,
      confidence: rule.confidence,
      reason: rule.reason,
      ruleId: rule.id,
    };
  }
  return FALLBACK;
}
