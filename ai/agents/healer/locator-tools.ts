import fs from "node:fs";
import path from "node:path";

// Pure helpers for the healer: find the broken locator in the error, find where a page
// object defines it, read the accessibility snapshot Playwright saved at failure
// (error-context.md), and propose replacement locators by our priority:
// getByRole > getByLabel > getByTestId > getByText. Never XPath, never CSS from here.

export type AriaNode = { role: string; name: string; depth: number };
export type LocatorHit = {
  file: string;
  line: number;
  text: string;
  expression: string;
  field?: string;
};
export type Candidate = { expression: string; reason: string; priority: number };

/** e.g. "getByTestId('btn-checkout')" from a Playwright error message. */
export function extractBrokenLocator(error: string): string | undefined {
  const strict = /strict mode violation: ((?:getBy\w+|locator)\(.*?\)) resolved to/.exec(error);
  if (strict) return strict[1];
  const waiting = /waiting for ((?:getBy\w+|locator)\(.*\))\s*$/m.exec(error);
  return waiting?.[1].trim();
}

/** Alternative unique locators Playwright suggests in a strict mode error ("aka ..."). */
export function strictModeSuggestions(error: string): string[] {
  return [...error.matchAll(/aka ((?:getBy\w+|locator)\(.*?\)(?:\.\w+\(.*?\))*)\s*$/gm)]
    .map((m) => m[1])
    .filter((s) => !/\.(first|last|nth)\(/.test(s));
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex that matches the locator in TypeScript source whatever quote style is used. */
export function sourcePattern(locator: string): RegExp {
  const body = escapeRegex(locator).replace(/'/g, "[\"'`]").replace(/\s+/g, "\\s*");
  return new RegExp(`(?:this\\.)?page\\.${body}`);
}

/** Lines in page objects / components that define the locator. */
export function findLocatorInSources(locator: string, dirs: string[]): LocatorHit[] {
  const pattern = sourcePattern(locator);
  const hits: LocatorHit[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        fs.readFileSync(full, "utf8")
          .split("\n")
          .forEach((text, i) => {
            const m = pattern.exec(text);
            if (m)
              hits.push({
                file: full,
                line: i,
                text,
                expression: m[0],
                field: /this\.(\w+)\s*=/.exec(text)?.[1],
              });
          });
      }
    }
  };
  dirs.forEach(walk);
  return hits;
}

/** Parses the "# Page snapshot" YAML of error-context.md into role/name nodes. */
export function parseAriaSnapshot(markdown: string): AriaNode[] {
  const block = /# Page snapshot\s*```yaml\s*([\s\S]*?)```/.exec(markdown)?.[1] ?? "";
  const nodes: AriaNode[] = [];
  for (const line of block.split("\n")) {
    const m = /^(\s*)- (\w+)(?: "((?:[^"\\]|\\.)*)")?/.exec(line);
    if (m)
      nodes.push({ role: m[2], name: (m[3] ?? "").replace(/\\"/g, '"'), depth: m[1].length / 2 });
  }
  return nodes;
}

const ROLE_HINTS: Record<string, string> = {
  btn: "button",
  button: "button",
  link: "link",
  lnk: "link",
  input: "textbox",
  txt: "textbox",
  field: "textbox",
  email: "textbox",
  password: "textbox",
  search: "searchbox",
  select: "combobox",
  dropdown: "combobox",
  chk: "checkbox",
  checkbox: "checkbox",
  radio: "radio",
  tab: "tab",
  menu: "menuitem",
  heading: "heading",
  title: "heading",
};

const words = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
const q = (s: string) => JSON.stringify(s);

function similarity(a: string, b: string): number {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (!wa.size || !wb.size) return 0;
  const common = [...wa].filter((w) => wb.has(w)).length;
  return common / Math.max(wa.size, wb.size);
}

function parseLocatorCall(
  locator: string,
): { method: string; arg: string; role?: string; name?: string } | undefined {
  const m =
    /^(getBy\w+)\(\s*['"`](.*?)['"`]\s*(?:,\s*\{\s*name:\s*['"`](.*?)['"`].*\})?\s*\)$/.exec(
      locator.trim(),
    );
  if (!m) return undefined;
  return { method: m[1], arg: m[2], role: m[1] === "getByRole" ? m[2] : undefined, name: m[3] };
}

/** Rule-based replacement candidates, best first. Only unique matches in the snapshot. */
export function ruleCandidates(locator: string, nodes: AriaNode[], error = ""): Candidate[] {
  const out: Candidate[] = [];
  const add = (expression: string, reason: string, priority: number) => {
    if (!out.some((c) => c.expression === expression)) out.push({ expression, reason, priority });
  };
  const unique = (role: string, name: string) =>
    nodes.filter((n) => n.role === role && n.name === name).length === 1;

  for (const s of strictModeSuggestions(error)) {
    add(
      s.replace(/'/g, '"'),
      "Unique locator suggested by Playwright in the strict mode error",
      s.startsWith("getByRole") ? 1 : s.startsWith("getByTestId") ? 3 : 4,
    );
  }

  const call = parseLocatorCall(locator);
  if (!call) return out.sort((a, b) => a.priority - b.priority);

  const named = nodes.filter((n) => n.name);
  if (call.method === "getByTestId") {
    const tokens = words(call.arg);
    const roleHint = tokens.map((t) => ROLE_HINTS[t]).find(Boolean);
    const nameTokens = tokens.filter((t) => !ROLE_HINTS[t]);
    const scored = named
      .filter((n) => !roleHint || n.role === roleHint)
      .map((n) => ({ n, score: similarity(nameTokens.join(" "), n.name) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const { n } of scored.slice(0, 2)) {
      if (unique(n.role, n.name))
        add(
          `getByRole(${q(n.role)}, { name: ${q(n.name)} })`,
          `test id "${call.arg}" is gone; a ${n.role} named "${n.name}" matches its words`,
          1,
        );
    }
  } else if (call.method === "getByRole" && call.role) {
    const sameRole = named.filter((n) => n.role === call.role);
    const scored = sameRole
      .map((n) => ({ n, score: similarity(call.name ?? "", n.name) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const { n } of scored.slice(0, 2)) {
      if (unique(n.role, n.name))
        add(
          `getByRole(${q(n.role)}, { name: ${q(n.name)} })`,
          `the ${call.role} was renamed to "${n.name}"`,
          1,
        );
    }
  } else if (call.method === "getByLabel" || call.method === "getByPlaceholder") {
    const scored = named
      .filter((n) =>
        ["textbox", "combobox", "searchbox", "spinbutton", "checkbox"].includes(n.role),
      )
      .map((n) => ({ n, score: similarity(call.arg, n.name) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const { n } of scored.slice(0, 2)) {
      if (unique(n.role, n.name))
        add(
          `getByRole(${q(n.role)}, { name: ${q(n.name)} })`,
          `the field label changed to "${n.name}"`,
          1,
        );
    }
  } else if (call.method === "getByText") {
    const scored = named
      .map((n) => ({ n, score: similarity(call.arg, n.name) }))
      .filter((x) => x.score > 0.4)
      .sort((a, b) => b.score - a.score);
    for (const { n } of scored.slice(0, 2)) {
      if (n.role !== "generic" && unique(n.role, n.name))
        add(`getByRole(${q(n.role)}, { name: ${q(n.name)} })`, `text changed to "${n.name}"`, 1);
      else add(`getByText(${q(n.name)})`, `text changed to "${n.name}"`, 4);
    }
  }
  return out.sort((a, b) => a.priority - b.priority);
}

const ALLOWED =
  /^(?:this\.)?page\.(getByRole|getByLabel|getByTestId|getByText|getByPlaceholder|getByAltText|getByTitle)\((?:[^()]|\([^()]*\))*\)(?:\.(first|last|nth|filter)\((?:[^()]|\([^()]*\))*\))*$/;

/** Guard for LLM / rule output: a single page.getBy*() expression, no XPath, no CSS. */
export function isAllowedLocator(expression: string): boolean {
  return ALLOWED.test(expression.trim()) && !/xpath|\/\//i.test(expression);
}

/**
 * Replaces the locator on one line. Throws if the change would touch anything else
 * or the line contains an assertion (the healer never edits assertions).
 */
export function applyLocatorChange(source: string, hit: LocatorHit, newExpression: string): string {
  const lines = source.split("\n");
  const line = lines[hit.line];
  if (line === undefined || !line.includes(hit.expression))
    throw new Error("Source changed since the locator was found");
  if (/\bexpect\s*\(/.test(line)) throw new Error("Refusing to edit a line with an assertion");
  const prefix = hit.expression.startsWith("this.page.") ? "this.page." : "page.";
  const replacement =
    newExpression.startsWith("page.") || newExpression.startsWith("this.page.")
      ? newExpression
      : prefix + newExpression;
  if (!isAllowedLocator(replacement)) throw new Error(`Not an allowed locator: ${replacement}`);
  lines[hit.line] = line.replace(hit.expression, replacement);
  return lines.join("\n");
}

export function unifiedDiff(file: string, before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const out = [`--- a/${file}`, `+++ b/${file}`];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) out.push(`@@ line ${i + 1} @@`, `-${a[i] ?? ""}`, `+${b[i] ?? ""}`);
  }
  return out.join("\n");
}
