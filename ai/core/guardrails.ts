// Per-run limits for LLM use: input size, output tokens, number of calls and budget.
// When a limit is hit the call is refused with GuardrailError and the caller falls back
// to rule-based logic, so a run can never overspend or hang on the LLM.

export class GuardrailError extends Error {
  name = "GuardrailError";
}

export type GuardrailLimits = {
  maxInputChars: number;
  maxOutputTokens: number;
  maxCallsPerRun: number;
  budgetUsd: number;
};

export const limitsFromEnv = (env: NodeJS.ProcessEnv = process.env): GuardrailLimits => ({
  maxInputChars: Number(env.LLM_MAX_INPUT_CHARS ?? 12000),
  maxOutputTokens: Number(env.LLM_MAX_OUTPUT_TOKENS ?? 1500),
  maxCallsPerRun: Number(env.LLM_MAX_CALLS_PER_RUN ?? 20),
  budgetUsd: Number(env.LLM_BUDGET_USD ?? 1),
});

export class Guardrails {
  private calls = 0;
  private spentUsd = 0;

  constructor(readonly limits: GuardrailLimits = limitsFromEnv()) {}

  /** Throws before a call that would exceed the call count or the budget. */
  beforeCall(): void {
    if (this.calls >= this.limits.maxCallsPerRun) {
      throw new GuardrailError(`LLM call limit reached (${this.limits.maxCallsPerRun} per run)`);
    }
    if (this.spentUsd >= this.limits.budgetUsd) {
      throw new GuardrailError(
        `LLM budget spent ($${this.spentUsd.toFixed(4)} of $${this.limits.budgetUsd})`,
      );
    }
    this.calls++;
  }

  checkInput(prompt: string): void {
    if (prompt.length > this.limits.maxInputChars) {
      throw new GuardrailError(
        `Prompt is ${prompt.length} chars; limit is ${this.limits.maxInputChars}`,
      );
    }
  }

  record(costUsd: number): void {
    this.spentUsd += costUsd;
  }

  get usage() {
    return { calls: this.calls, spentUsd: this.spentUsd };
  }
}
