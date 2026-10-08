import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";

// Small persistence abstraction. Today: JSON files (repo data/ folder, pipeline
// artifacts, dashboard/.cache). Tomorrow: a database can implement the same interface
// without changing callers (the Repository pattern from Spring Data, minus the framework).

export interface Store {
  /** Returns undefined when missing, expired, or not matching the schema. */
  get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined>;
  /** ttlMs: optional time-to-live (cache use) */
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

type Envelope = { value: unknown; expiresAt?: number };

const safeKey = (key: string) => key.replace(/[^a-zA-Z0-9._-]+/g, "_");

/** One pretty-printed JSON file per key in a directory. */
export class JsonFileStore implements Store {
  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private file(key: string) {
    return path.join(this.dir, `${safeKey(key)}.json`);
  }

  async get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    const file = this.file(key);
    if (!fs.existsSync(file)) return undefined;
    try {
      const env = JSON.parse(await fs.promises.readFile(file, "utf8")) as Envelope;
      if (env.expiresAt !== undefined && env.expiresAt < this.now()) return undefined;
      const parsed = schema.safeParse(env.value);
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined; // a corrupt cache entry is treated as a miss
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true });
    const env: Envelope = {
      value,
      expiresAt: ttlMs === undefined ? undefined : this.now() + ttlMs,
    };
    // write-then-rename so a crash never leaves half a file
    const tmp = `${this.file(key)}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(env, null, 2));
    await fs.promises.rename(tmp, this.file(key));
  }

  async delete(key: string): Promise<void> {
    await fs.promises.rm(this.file(key), { force: true });
  }

  async keys(prefix = ""): Promise<string[]> {
    if (!fs.existsSync(this.dir)) return [];
    return (await fs.promises.readdir(this.dir))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .filter((k) => k.startsWith(safeKey(prefix)));
  }
}

/** In-memory store for unit tests and DASHBOARD_MOCK mode. */
export class MemoryStore implements Store {
  private data = new Map<string, Envelope>();
  constructor(private readonly now: () => number = Date.now) {}

  async get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    const env = this.data.get(key);
    if (!env || (env.expiresAt !== undefined && env.expiresAt < this.now())) return undefined;
    const parsed = schema.safeParse(structuredClone(env.value));
    return parsed.success ? parsed.data : undefined;
  }
  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.data.set(key, {
      value: structuredClone(value),
      expiresAt: ttlMs === undefined ? undefined : this.now() + ttlMs,
    });
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async keys(prefix = ""): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}
