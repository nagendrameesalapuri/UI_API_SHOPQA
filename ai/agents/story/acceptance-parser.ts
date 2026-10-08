import { z } from "zod";

// Deterministic acceptance-criteria parser (LLM_PROVIDER=none). Understands:
//  - Gherkin: Scenario/Given/When/Then/And/But (one scenario per "Scenario:" or per Given block)
//  - bullet lists (-, *, •) and numbered lists (1. / 1) / a.): one scenario per item
//  - free text: one scenario per sentence-ish line, marked TODO
// Azure DevOps stores Description/AC as HTML, so HTML is flattened first.

export const scenarioSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["positive", "negative", "edge"]).default("positive"),
  level: z.enum(["ui", "api", "e2e"]).default("ui"),
  given: z.array(z.string()).default([]),
  when: z.array(z.string()).default([]),
  then: z.array(z.string()).default([]),
  tags: z.array(z.string()).default(["@Regression"]),
  assumptions: z.array(z.string()).default([]),
  /** Filled by the generator when a Test Case is created in Azure Test Plans */
  tcId: z.number().optional(),
});
export type Scenario = z.infer<typeof scenarioSchema>;
export const planSchema = z.object({ scenarios: z.array(scenarioSchema).min(1) });

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

const GHERKIN = /^(Scenario(?: Outline)?|Given|When|Then|And|But)\b:?\s*(.*)$/i;
const LIST_ITEM = /^(?:[-*•]|\d+[.)]|[a-z][.)])\s+(.*)$/i;
const NEGATIVE =
  /\b(not|cannot|can't|invalid|error|reject|fail|denied|without|empty|missing|wrong)\b/i;
const EDGE =
  /\b(maximum|minimum|limit|boundary|zero|exactly|more than|less than|at least|at most|expired|duplicate)\b/i;
const API_HINT = /\b(api|endpoint|status code|response|request|json)\b/i;

function classifyType(text: string): Scenario["type"] {
  if (NEGATIVE.test(text)) return "negative";
  if (EDGE.test(text)) return "edge";
  return "positive";
}

const shortTitle = (s: string) => {
  const clean = s.replace(/[.;:]+$/, "").trim();
  return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean;
};

function parseGherkin(lines: string[]): Scenario[] {
  const scenarios: Scenario[] = [];
  let current: Scenario | undefined;
  let section: "given" | "when" | "then" = "given";

  const start = (title?: string) => {
    current = scenarioSchema.parse({ title: title || "Scenario", given: [], when: [], then: [] });
    scenarios.push(current);
    section = "given";
  };

  for (const line of lines) {
    const m = GHERKIN.exec(line);
    if (!m) continue;
    const keyword = m[1].toLowerCase();
    const text = m[2].trim();
    if (keyword.startsWith("scenario")) {
      start(text);
      continue;
    }
    if (keyword === "given" && current && (current.when.length || current.then.length)) start();
    if (!current) start();
    if (keyword === "given" || keyword === "when" || keyword === "then") section = keyword;
    current![section].push(text);
  }

  for (const s of scenarios) {
    if (s.title === "Scenario")
      s.title = shortTitle(s.then[0] ?? s.when[0] ?? s.given[0] ?? "Scenario");
    const all = [s.title, ...s.given, ...s.when, ...s.then].join(" ");
    // The type comes from what happens and what is expected, not from the preconditions
    s.type = classifyType([s.title, ...s.when, ...s.then].join(" "));
    s.level = API_HINT.test(all) ? "api" : "ui";
    if (!s.when.length) s.assumptions.push("TODO: no When step in the acceptance criteria");
    if (!s.then.length) s.assumptions.push("TODO: no Then step: define the expected result");
  }
  return scenarios;
}

function fromStatements(statements: string[], fromList: boolean): Scenario[] {
  return statements.map((text) =>
    scenarioSchema.parse({
      title: shortTitle(text),
      type: classifyType(text),
      level: API_HINT.test(text) ? "api" : "ui",
      given: ["TODO: describe the starting state (user role, data)"],
      when: ["TODO: describe the user action"],
      then: [text],
      assumptions: [
        fromList
          ? "Derived from a list item: confirm the Given/When steps"
          : "Derived from free text: review carefully",
      ],
    }),
  );
}

export function parseAcceptanceCriteria(raw: string): Scenario[] {
  const text = /<[a-z][\s\S]*>/i.test(raw) ? htmlToText(raw) : raw;
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  if (lines.some((l) => /^(Given|When|Then)\b/i.test(l))) return parseGherkin(lines);

  const items = lines.flatMap((l) => {
    const m = LIST_ITEM.exec(l);
    return m ? [m[1]] : [];
  });
  if (items.length) return fromStatements(items, true);

  const sentences = lines
    .flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z])/))
    .filter((s) => s.length > 8);
  return fromStatements(sentences, false);
}
