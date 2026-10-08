import { spawnSync } from "node:child_process";

// Validation of a generated spec: typecheck, lint, then run it 3 times.
// Used in LLM mode to drive the fix loop (rule-based skeletons are test.fixme and only
// need to compile and lint).

export type ValidationResult = {
  ok: boolean;
  step?: "typecheck" | "lint" | "test";
  output: string;
};

function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
): { status: number | null; output: string } {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: timeoutMs,
    env: process.env,
  });
  return { status: r.status, output: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim() };
}

export function validateSpec(file: string, opts: { runTests?: boolean } = {}): ValidationResult {
  const tsc = run("npx", ["tsc", "--noEmit", "-p", "."], 300_000);
  if (tsc.status !== 0) {
    // Only this file's errors are relevant for the fix loop
    const mine = tsc.output
      .split("\n")
      .filter((l) => l.replace(/\\/g, "/").includes(file.replace(/\\/g, "/")));
    if (mine.length)
      return { ok: false, step: "typecheck", output: mine.join("\n").slice(0, 4000) };
  }
  const lint = run("npx", ["eslint", file], 120_000);
  if (lint.status !== 0) return { ok: false, step: "lint", output: lint.output.slice(0, 4000) };
  if (opts.runTests) {
    const test = run(
      "npx",
      ["playwright", "test", file, "--repeat-each=3", "--reporter=line"],
      900_000,
    );
    if (test.status !== 0) return { ok: false, step: "test", output: test.output.slice(-4000) };
  }
  return {
    ok: true,
    output: "typecheck, lint" + (opts.runTests ? " and 3 test runs" : "") + " passed",
  };
}
