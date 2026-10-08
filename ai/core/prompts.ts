import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// Prompt templates live in ai/prompts/*.md with front-matter:
//   ---
//   id: triage-failure
//   version: 1.0.0
//   ---
//   Body with {{placeholders}}.
// Versioning prompts like code means the cost log can tell which version produced what.

export type PromptTemplate = { id: string; version: string; description?: string; body: string };

const frontMatterSchema = z.object({
  id: z.string(),
  version: z.string(),
  description: z.string().optional(),
});

export const PROMPTS_DIR = path.resolve(__dirname, "..", "prompts");

export function parsePrompt(source: string): PromptTemplate {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error("Prompt file must start with front-matter (--- id/version ---)");
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { ...frontMatterSchema.parse(fields), body: match[2].trim() };
}

export function loadPrompt(id: string, dir = PROMPTS_DIR): PromptTemplate {
  const file = path.join(dir, `${id}.md`);
  const prompt = parsePrompt(fs.readFileSync(file, "utf8"));
  if (prompt.id !== id)
    throw new Error(`${file}: front-matter id "${prompt.id}" does not match file name`);
  return prompt;
}

/** Replaces {{name}}; a placeholder without a value is an error (never silently empty). */
export function renderPrompt(
  template: PromptTemplate,
  vars: Record<string, string | number>,
): string {
  const missing = new Set<string>();
  const out = template.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    if (!(name in vars)) {
      missing.add(name);
      return "";
    }
    return String(vars[name]);
  });
  if (missing.size)
    throw new Error(`Prompt ${template.id}: missing values for ${[...missing].join(", ")}`);
  return out;
}
