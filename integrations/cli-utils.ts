import { parseArgs, type ParseArgsConfig } from "node:util";
import { loadEnvFiles } from "../src/config/env";

// Shared helpers for the tsx CLI entry points (npm run ado:*, triage, agent:*).

export function cliArgs<T extends NonNullable<ParseArgsConfig["options"]>>(options: T) {
  loadEnvFiles();
  return parseArgs({ options, allowPositionals: false, strict: true }).values;
}

/** Pipeline output variable (visible to later steps/stages). No-op outside Azure Pipelines. */
export function setPipelineVariable(name: string, value: string | number, isOutput = true): void {
  if (process.env.TF_BUILD) {
    console.log(`##vso[task.setvariable variable=${name};isOutput=${isOutput}]${value}`);
  }
}

export function pipelineWarning(message: string): void {
  console.log(
    process.env.TF_BUILD ? `##vso[task.logissue type=warning]${message}` : `WARN ${message}`,
  );
}

/** Runs an async main, printing a readable error and setting the exit code. */
export function runCli(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exitCode = 1;
  });
}

export const toInt = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${name} must be a positive integer, got "${v}"`);
  return n;
};
