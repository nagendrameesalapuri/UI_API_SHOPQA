import { expect as baseExpect } from "@playwright/test";

// Custom matchers, registered with expect.extend (like a Hamcrest Matcher in Java).
// Usage: expect(prices).toBeSorted("desc")

export function isSorted(values: readonly (number | string)[], direction: "asc" | "desc"): boolean {
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if (direction === "asc" ? prev > curr : prev < curr) return false;
  }
  return true;
}

export const expect = baseExpect.extend({
  toBeSorted(received: (number | string)[], direction: "asc" | "desc" = "asc") {
    const pass = isSorted(received, direction);
    return {
      pass,
      name: "toBeSorted",
      message: () =>
        `expected ${JSON.stringify(received)} ${pass ? "not " : ""}to be sorted ${direction}`,
    };
  },
});
