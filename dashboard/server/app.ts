import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AdoError } from "../../integrations/ado/ado-client";
import { configSchema, newRunRequestSchema, ENVIRONMENTS } from "../shared/contracts";
import { type DashboardService, NotFoundError } from "./service";

// HTTP layer of the Release Dashboard. The Azure DevOps PAT lives only in the server
// process (env var); the browser talks to these routes and never sees a token.

export type AppOptions = {
  service: DashboardService;
  mock: boolean;
  pollSeconds?: number;
  /** Basic auth credentials; when unset the API is open (local/mock use only) */
  auth?: { user: string; password: string };
  /** Built web app to serve (dashboard/dist) */
  staticDir?: string;
};

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

export function basicAuth(creds: { user: string; password: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const [user, ...rest] = Buffer.from(encoded, "base64").toString().split(":");
      if (safeEqual(user, creds.user) && safeEqual(rest.join(":"), creds.password)) {
        res.locals.user = user;
        return next();
      }
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="Release Dashboard"');
    res.status(401).json({ error: "Authentication required" });
  };
}

// Express 5 forwards rejected promises to the error handler, so handlers can be async.
type Handler = (req: Request, res: Response) => Promise<void>;
const route = (fn: Handler) => fn;

export function createApp(opts: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, mock: opts.mock });
  });

  if (opts.auth) app.use(basicAuth(opts.auth));
  const s = opts.service;

  app.get("/api/config", (_req, res) => {
    res.json(
      configSchema.parse({
        mock: opts.mock,
        pollSeconds: opts.pollSeconds ?? 15,
        environments: [...ENVIRONMENTS],
        user: res.locals.user,
      }),
    );
  });

  app.post(
    "/api/runs",
    route(async (req, res) => {
      const body = newRunRequestSchema.parse(req.body);
      res.status(201).json(await s.startRun(body, res.locals.user as string | undefined));
    }),
  );

  app.get(
    "/api/runs",
    route(async (_req, res) => {
      res.json(await s.listRuns());
    }),
  );

  app.get(
    "/api/runs/:id/progress",
    route(async (req, res) => {
      const progress = await s.getProgress(String(req.params.id));
      if (!progress) throw new NotFoundError("Run not found");
      res.json(progress);
    }),
  );

  app.get(
    "/api/runs/:id/results",
    route(async (req, res) => {
      const results = await s.getResults(String(req.params.id));
      if (!results) {
        res.status(404).json({ error: "Results are not available yet" });
        return;
      }
      res.json(results);
    }),
  );

  app.get(
    "/api/trend",
    route(async (req, res) => {
      const n = z.coerce.number().int().min(1).max(50).catch(10).parse(req.query.n);
      res.json(await s.getTrend(n));
    }),
  );

  app.get(
    "/api/releases",
    route(async (_req, res) => {
      res.json(await s.listReleases());
    }),
  );

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unknown API route" });
  });

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir, { index: false }));
    // SPA fallback: every non-API route returns index.html
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(opts.staticDir!, "index.html"));
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: "Invalid request", details: z.flattenError(error).fieldErrors });
    } else if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
    } else if (error instanceof AdoError) {
      // Pass the reason, never headers/tokens
      res.status(502).json({
        error: `Azure DevOps error (${error.status}): ${error.message.split(" failed:")[0]}`,
      });
    } else {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  return app;
}
