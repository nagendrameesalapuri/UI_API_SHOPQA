import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// Masks personal data and secrets BEFORE anything is sent to an LLM.
// Rules are an ordered, configurable list: add patterns in data/redact.json without
// touching code. Order matters: specific tokens (JWT, keys) before generic numbers.

export type RedactionRule = { name: string; pattern: RegExp; replacement: string };

export const DEFAULT_RULES: RedactionRule[] = [
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
    replacement: "[JWT]",
  },
  {
    name: "bearer",
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g,
    replacement: "$1 [TOKEN]",
  },
  {
    name: "api-key",
    pattern: /\b(sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9-_]{16,}\b/g,
    replacement: "[API_KEY]",
  },
  {
    name: "secret-assignment",
    pattern: /\b(password|passwd|pwd|secret|token|api[-_]?key)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
    replacement: "$1$2[SECRET]",
  },
  {
    name: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[EMAIL]",
  },
  // 17-char VIN (no I, O, Q)
  { name: "vin", pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/g, replacement: "[VIN]" },
  // UK registration (AB12 CDE) and Indian registration (KA 01 AB 1234)
  { name: "uk-reg", pattern: /\b[A-Z]{2}[0-9]{2}\s?[A-Z]{3}\b/g, replacement: "[VEHICLE_REG]" },
  {
    name: "in-reg",
    pattern: /\b[A-Z]{2}[ -]?[0-9]{1,2}[ -]?[A-Z]{1,3}[ -]?[0-9]{4}\b/g,
    replacement: "[VEHICLE_REG]",
  },
  {
    name: "phone",
    pattern: /(?<![\w-])(\+?\d{1,3}[\s-]?)?(\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}(?![\w-])/g,
    replacement: "[PHONE]",
  },
];

const configSchema = z.object({
  patterns: z
    .array(
      z.object({
        name: z.string(),
        regex: z.string(),
        flags: z.string().default("g"),
        replacement: z.string().optional(),
      }),
    )
    .default([]),
  names: z.array(z.string()).default([]),
});

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class Redactor {
  constructor(
    private readonly rules: RedactionRule[] = DEFAULT_RULES,
    names: string[] = [],
  ) {
    const clean = names.map((n) => n.trim()).filter((n) => n.length > 1);
    if (clean.length) {
      this.rules = [
        ...rules,
        {
          name: "person-name",
          pattern: new RegExp(`\\b(${clean.map(escapeRegex).join("|")})\\b`, "gi"),
          replacement: "[NAME]",
        },
      ];
    }
  }

  /** Loads extra patterns / names from data/redact.json and REDACT_NAMES (comma-separated). */
  static fromConfig(
    file = path.resolve("data", "redact.json"),
    env: NodeJS.ProcessEnv = process.env,
  ): Redactor {
    const cfg = fs.existsSync(file)
      ? configSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")))
      : configSchema.parse({});
    const extra = cfg.patterns.map((p) => ({
      name: p.name,
      pattern: new RegExp(p.regex, p.flags.includes("g") ? p.flags : `${p.flags}g`),
      replacement: p.replacement ?? `[${p.name.toUpperCase()}]`,
    }));
    const names = [...cfg.names, ...(env.REDACT_NAMES ?? "").split(",")];
    return new Redactor([...DEFAULT_RULES, ...extra], names);
  }

  redact(text: string): { text: string; counts: Record<string, number> } {
    const counts: Record<string, number> = {};
    let out = text;
    for (const rule of this.rules) {
      out = out.replace(rule.pattern, (...args: unknown[]) => {
        counts[rule.name] = (counts[rule.name] ?? 0) + 1;
        // Re-apply the replacement with group references ($1, $2)
        const groups = args.slice(1, -2) as (string | undefined)[];
        return rule.replacement.replace(/\$(\d)/g, (_, i: string) => groups[Number(i) - 1] ?? "");
      });
    }
    return { text: out, counts };
  }
}

/** Keeps the start and end of long text (errors usually matter at both ends). */
export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = `\n...[${text.length - maxChars} chars truncated]...\n`;
  const keep = Math.max(0, maxChars - marker.length);
  return (
    text.slice(0, Math.ceil(keep * 0.7)) + marker + text.slice(text.length - Math.floor(keep * 0.3))
  );
}
