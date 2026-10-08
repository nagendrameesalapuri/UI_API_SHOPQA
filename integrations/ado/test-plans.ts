import { z } from "zod";
import type { AdoClient } from "./ado-client";

// Azure Test Plans: release plan, suites, test cases and test points.
// REST: https://learn.microsoft.com/rest/api/azure/devops/testplan (7.1)

export const planSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    state: z.string().optional(),
    rootSuite: z.object({ id: z.number() }).loose().optional(),
    areaPath: z.string().optional(),
    iteration: z.string().optional(),
  })
  .loose();
export type TestPlan = z.infer<typeof planSchema>;

export const suiteSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    suiteType: z.string().optional(),
    parentSuite: z.object({ id: z.number() }).loose().nullish(),
  })
  .loose();
export type TestSuite = z.infer<typeof suiteSchema>;

export const testPointSchema = z
  .object({
    id: z.number(),
    testCaseReference: z.object({ id: z.number(), name: z.string().optional() }).loose(),
    configuration: z
      .object({ id: z.number().optional(), name: z.string().optional() })
      .loose()
      .optional(),
    testSuite: z.object({ id: z.number().optional() }).loose().optional(),
  })
  .loose();
export type TestPoint = z.infer<typeof testPointSchema>;

const suiteTestCaseSchema = z.object({ workItem: z.object({ id: z.number() }).loose() }).loose();

export const releasePlanName = (releaseVersion: string) => `Regression ${releaseVersion}`;

export type SuiteSpec =
  | { name: string; type: "static" }
  /** Query-based suite, e.g. all Test Cases tagged "cart" */
  | { name: string; type: "query"; wiql: string };

export async function listPlans(client: AdoClient): Promise<TestPlan[]> {
  return client.getAllPages("testplan/plans", planSchema, { filterActivePlans: true });
}

export async function getPlan(client: AdoClient, planId: number): Promise<TestPlan> {
  return client.get(`testplan/plans/${planId}`, { schema: planSchema });
}

/**
 * Creates the plan "Regression <releaseVersion>", or reuses it if it already exists
 * (idempotent: safe to call from the dashboard and from every pipeline run).
 */
export async function createReleasePlan(
  client: AdoClient,
  opts: { releaseVersion: string; areaPath?: string; iteration?: string },
): Promise<{ plan: TestPlan; created: boolean }> {
  const name = releasePlanName(opts.releaseVersion);
  const existing = (await listPlans(client)).find((p) => p.name === name);
  if (existing) return { plan: existing, created: false };

  const plan = await client.post("testplan/plans", {
    schema: planSchema,
    body: {
      name,
      areaPath: opts.areaPath,
      iteration: opts.iteration,
      description: `Automated regression for release ${opts.releaseVersion} (created by the Playwright framework).`,
    },
  });
  return { plan, created: true };
}

export async function listSuites(client: AdoClient, planId: number): Promise<TestSuite[]> {
  return client.getAllPages(`testplan/Plans/${planId}/suites`, suiteSchema);
}

/**
 * Makes sure every suite in `structure` exists directly under the plan's root suite.
 * Returns suite name -> id. Existing suites (by name) are reused.
 */
export async function ensureSuites(
  client: AdoClient,
  planId: number,
  structure: SuiteSpec[],
): Promise<Record<string, number>> {
  const suites = await listSuites(client, planId);
  const root = suites.find((s) => !s.parentSuite) ?? (await getPlan(client, planId)).rootSuite;
  if (!root) throw new Error(`Plan ${planId} has no root suite`);

  const ids: Record<string, number> = {};
  for (const spec of structure) {
    const existing = suites.find((s) => s.name === spec.name && s.parentSuite?.id === root.id);
    if (existing) {
      ids[spec.name] = existing.id;
      continue;
    }
    const created = await client.post(`testplan/Plans/${planId}/suites`, {
      schema: suiteSchema,
      body:
        spec.type === "static"
          ? { suiteType: "staticTestSuite", name: spec.name, parentSuite: { id: root.id } }
          : {
              suiteType: "dynamicTestSuite",
              name: spec.name,
              parentSuite: { id: root.id },
              queryString: spec.wiql,
            },
    });
    ids[spec.name] = created.id;
  }
  return ids;
}

/** WIQL for a query-based suite containing Test Cases with a given tag. */
export function testCasesTaggedWiql(tag: string): string {
  const safe = tag.replace(/'/g, "''");
  return (
    "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] IN GROUP 'Microsoft.TestCaseCategory' " +
    `AND [System.Tags] CONTAINS '${safe}'`
  );
}

/** Adds Test Cases to a static suite; ids already in the suite are skipped (idempotent). */
export async function addTestCases(
  client: AdoClient,
  planId: number,
  suiteId: number,
  testCaseIds: number[],
): Promise<number[]> {
  const path = `testplan/Plans/${planId}/Suites/${suiteId}/TestCase`;
  const existing = new Set(
    (await client.getAllPages(path, suiteTestCaseSchema)).map((tc) => tc.workItem.id),
  );
  const toAdd = [...new Set(testCaseIds)].filter((id) => !existing.has(id));
  if (toAdd.length === 0) return [];
  await client.post(path, {
    schema: z.unknown(),
    body: toAdd.map((id) => ({ workItem: { id } })),
  });
  return toAdd;
}

export async function getTestPoints(
  client: AdoClient,
  planId: number,
  suiteId: number,
): Promise<TestPoint[]> {
  return client.getAllPages(
    `testplan/Plans/${planId}/Suites/${suiteId}/TestPoint`,
    testPointSchema,
  );
}

/** Every test point in the plan, across all suites. */
export async function getAllTestPoints(client: AdoClient, planId: number): Promise<TestPoint[]> {
  const suites = await listSuites(client, planId);
  const points: TestPoint[] = [];
  for (const suite of suites) points.push(...(await getTestPoints(client, planId, suite.id)));
  return points;
}
