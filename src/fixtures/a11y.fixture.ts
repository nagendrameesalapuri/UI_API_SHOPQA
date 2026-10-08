import AxeBuilder from "@axe-core/playwright";
import { test as base, expect } from "@playwright/test";

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;
type Violation = AxeResults["violations"][number];

export type A11yOptions = {
  /** CSS selectors to scan (default: whole page) */
  include?: string[];
  /** CSS selectors to leave out (third-party widgets, known issues) */
  exclude?: string[];
};

type A11yFixtures = {
  a11y: {
    /**
     * Runs axe-core with WCAG 2 A/AA rules, attaches the full JSON report to the test,
     * and fails only on serious/critical violations.
     */
    check: (options?: A11yOptions) => Promise<AxeResults>;
  };
};

const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

export function blockingViolations(violations: Violation[]): Violation[] {
  return violations.filter((v) => v.impact != null && BLOCKING_IMPACTS.has(v.impact));
}

export const test = base.extend<A11yFixtures>({
  a11y: async ({ page }, use, testInfo) => {
    await use({
      check: async (options = {}) => {
        let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
        for (const sel of options.include ?? []) builder = builder.include(sel);
        for (const sel of options.exclude ?? []) builder = builder.exclude(sel);

        const results = await builder.analyze();
        await testInfo.attach("axe-report", {
          body: JSON.stringify(results, null, 2),
          contentType: "application/json",
        });

        const blocking = blockingViolations(results.violations).map(
          (v) => `${v.impact}: ${v.id} - ${v.help} (${v.nodes.length} node(s))`,
        );
        expect(blocking, "serious/critical accessibility violations").toEqual([]);
        return results;
      },
    });
  },
});
