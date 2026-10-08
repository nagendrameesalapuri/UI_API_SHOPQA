import { mergeTests } from "@playwright/test";
import { test as uiTest } from "../../fixtures/ui.fixture";
import { test as apiTest } from "../../fixtures/api.fixture";
import { test as authTest } from "./auth.fixture";
import { test as a11yTest } from "./a11y.fixture";
import { test as networkTest } from "./network.fixture";

// Single entry point for NEW specs: `import { test, expect } from "@src/fixtures"`.
// mergeTests combines independent fixture sets (like composing several Serenity step
// libraries into one test class). The shop-app page objects, API clients and test data
// come from the existing fixtures/ folder, which stays the source of truth.
export const test = mergeTests(uiTest, apiTest, authTest, a11yTest, networkTest);
export { expect } from "../utils/matchers";
