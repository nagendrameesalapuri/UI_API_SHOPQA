import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "./audit";
import { appendUsage, estimateCost, readUsage, summarizeUsage } from "./cost-log";
import { loadPrompt, parsePrompt, renderPrompt } from "./prompts";
import { Redactor, truncateMiddle } from "./redact";

describe("Redactor", () => {
  const r = new Redactor(undefined, ["Priya Sharma", "John"]);

  it.each([
    ["email", "user john@test.com failed", "user [EMAIL] failed"],
    ["jwt", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk", "token [JWT]"],
    ["bearer", "Authorization: Bearer abcdef123456789", "Authorization: Bearer [TOKEN]"],
    ["secret assignment", 'password: "not-a-real-secret"', 'password: "[SECRET]"'],
    ["api key", "key sk-ant-abcdefghijklmnopqrstuv", "key [API_KEY]"],
    ["phone", "call +91 98765 43210 now", "call [PHONE] now"],
    ["VIN", "vin 1HGCM82633A004352 found", "vin [VIN] found"],
    ["UK reg", "vehicle AB12 CDE off road", "vehicle [VEHICLE_REG] off road"],
    ["names", "Customer Priya Sharma and john", "Customer [NAME] and [NAME]"],
  ])("masks %s", (_, input, expected) => {
    expect(r.redact(input).text).toBe(expected);
  });

  it("keeps technical text intact and counts what it masked", () => {
    const text = "locator.click: Timeout 10000ms exceeded. Expected: 201 Received: 409";
    expect(r.redact(text)).toEqual({ text, counts: {} });
    expect(r.redact("a@b.co c@d.co").counts).toEqual({ email: 2 });
  });

  it("loads extra patterns and names from config", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "redact-"));
    const file = path.join(dir, "redact.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ patterns: [{ name: "order-no", regex: "ORD-\\d+" }], names: ["Ravi"] }),
    );
    const custom = Redactor.fromConfig(file, { REDACT_NAMES: "Asha" });
    expect(custom.redact("ORD-123 for Ravi and Asha").text).toBe(
      "[ORDER-NO] for [NAME] and [NAME]",
    );
  });
});

describe("truncateMiddle", () => {
  it("keeps head and tail within the limit", () => {
    const out = truncateMiddle("a".repeat(500) + "b".repeat(500), 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.startsWith("aaa")).toBe(true);
    expect(out.endsWith("bbb")).toBe(true);
  });
});

describe("prompts", () => {
  it("parses front-matter and renders placeholders", () => {
    const p = parsePrompt("---\nid: x\nversion: 1.2.0\n---\nHello {{ name }}, {{n}}!");
    expect(p).toMatchObject({ id: "x", version: "1.2.0" });
    expect(renderPrompt(p, { name: "QA", n: 3 })).toBe("Hello QA, 3!");
    expect(() => renderPrompt(p, { name: "QA" })).toThrowError(/missing values for n/);
  });

  it.each(["triage-failure", "plan-from-story", "generate-spec", "fix-spec", "heal-locator"])(
    "ships prompt %s with matching id",
    (id) => {
      const p = loadPrompt(id);
      expect(p.id).toBe(id);
      expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
    },
  );
});

describe("cost log and audit", () => {
  it("appends JSON lines and summarises by agent", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cost-")), "u.jsonl");
    const base = {
      promptId: "p",
      promptVersion: "1",
      provider: "anthropic",
      model: "m",
      ms: 5,
      ok: true,
    };
    appendUsage(
      {
        ...base,
        agent: "triage",
        inputTokens: 1000,
        outputTokens: 100,
        costUsd: estimateCost(1000, 100, {
          LLM_PRICE_INPUT_PER_1K: "0.005",
          LLM_PRICE_OUTPUT_PER_1K: "0.025",
        }),
      },
      file,
    );
    appendUsage({ ...base, agent: "healer", inputTokens: 10, outputTokens: 1, costUsd: 0 }, file);
    const s = summarizeUsage(readUsage(file));
    expect(s.calls).toBe(2);
    expect(s.costUsd).toBeCloseTo(0.0075);
    expect(s.byAgent.triage.calls).toBe(1);
  });

  it("audit writes hashed inputs, never raw ones", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "audit-")), "a.jsonl");
    audit(
      { agent: "healer", action: "open-pr", inputs: { secret: "s3cr3t" }, outcome: "ok" },
      file,
    );
    const line = fs.readFileSync(file, "utf8");
    expect(line).not.toContain("s3cr3t");
    expect(JSON.parse(line)).toMatchObject({
      agent: "healer",
      action: "open-pr",
      outcome: "ok",
      inputsHash: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });
});
