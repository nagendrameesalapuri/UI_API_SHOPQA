import fs from "node:fs";
import path from "node:path";

// Structured JSON-lines logging. One line per event is easy to grep, to parse in
// pipelines, and to load into any log tool later (like Logback with a JSON encoder).

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const SECRET_KEYS =
  /^(authorization|password|pass|pwd|token|access_?token|refresh_?token|api[-_]?key|secret|cookie|set-cookie|pat)$/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

/** Deep-copies a value, replacing secret-looking keys and tokens with "***". */
export function maskSecrets<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(BEARER, "$1 ***").replace(JWT, "***") as T;
  }
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "***" : maskSecrets(v);
    }
    return out as T;
  }
  return value;
}

export class Logger {
  constructor(
    private readonly name: string,
    private readonly file?: string,
    private readonly minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info",
  ) {}

  private static readonly order: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  log(level: LogLevel, message: string, fields: LogFields = {}): void {
    if (Logger.order[level] < Logger.order[this.minLevel]) return;
    const line = JSON.stringify(
      maskSecrets({ ts: new Date().toISOString(), level, logger: this.name, message, ...fields }),
    );
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, line + "\n");
    } else if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  debug(message: string, fields?: LogFields) {
    this.log("debug", message, fields);
  }
  info(message: string, fields?: LogFields) {
    this.log("info", message, fields);
  }
  warn(message: string, fields?: LogFields) {
    this.log("warn", message, fields);
  }
  error(message: string, fields?: LogFields) {
    this.log("error", message, fields);
  }
}

export const createLogger = (name: string, file?: string) => new Logger(name, file);
