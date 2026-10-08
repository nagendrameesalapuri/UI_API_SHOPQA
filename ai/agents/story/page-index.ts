import fs from "node:fs";
import path from "node:path";

// Index of the existing page objects and their public async methods, so generated specs
// (and the LLM prompt) can point at real methods instead of inventing locators.

export type PageMethod = {
  page: string;
  fixture: string;
  method: string;
  signature: string;
  words: string[];
  methodWords: string[];
};

const splitWords = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

const STOP = new Set([
  "the",
  "and",
  "with",
  "from",
  "page",
  "verify",
  "navigate",
  "should",
  "user",
  "that",
  "can",
  "has",
  "for",
  "into",
  "when",
  "then",
  "given",
]);

export function indexPageObjects(pagesDir = path.resolve("pages")): PageMethod[] {
  const out: PageMethod[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) {
        const src = fs.readFileSync(full, "utf8");
        const cls = /export class (\w+)/.exec(src)?.[1];
        if (!cls) continue;
        const fixture = cls[0].toLowerCase() + cls.slice(1);
        for (const m of src.matchAll(/^\s{2}async (\w+)\(([^)]*)\)/gm)) {
          out.push({
            page: cls,
            fixture,
            method: m[1],
            signature: `${m[1]}(${m[2].replace(/\s+/g, " ").trim()})`,
            words: splitWords(`${cls} ${m[1]}`),
            methodWords: splitWords(m[1]),
          });
        }
      }
    }
  };
  if (fs.existsSync(pagesDir)) walk(pagesDir);
  return out;
}

/**
 * Best page-object methods for a step, by word overlap. Words in the method name count
 * double; admin pages are only suggested when the step talks about an admin.
 */
export function suggestMethods(step: string, index: PageMethod[], max = 2): PageMethod[] {
  const words = new Set(splitWords(step).filter((w) => !STOP.has(w)));
  if (words.size === 0) return [];
  const hit = (w: string) => !STOP.has(w) && (words.has(w) || words.has(w.replace(/s$/, "")));
  const mentionsAdmin = words.has("admin");
  return (
    index
      .map((m) => ({
        m,
        score:
          2 * m.methodWords.filter(hit).length +
          m.words.filter((w) => hit(w) && !m.methodWords.includes(w)).length -
          (m.page.startsWith("Admin") && !mentionsAdmin ? 2 : 0),
      }))
      // At least one word must match the method name itself
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((x) => x.m)
  );
}

export function describeIndex(index: PageMethod[]): string {
  const byPage = new Map<string, string[]>();
  for (const m of index)
    byPage.set(`${m.page} (fixture: ${m.fixture})`, [
      ...(byPage.get(`${m.page} (fixture: ${m.fixture})`) ?? []),
      m.signature,
    ]);
  return [...byPage].map(([p, ms]) => `- ${p}: ${ms.join(", ")}`).join("\n");
}
