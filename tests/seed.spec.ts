import { test, expect } from "../src/fixtures";
import { ProductListPage } from "../pages/ProductListPage";

// Seed test for the Playwright Test Agents (planner / generator / healer).
// It shows the agents how our tests start: fixtures injected, a signed-in role, page
// objects for every action, web-first or custom-matcher assertions. Generated tests
// copy this shape.
test("seed: signed-in customer sorts the product catalogue by price", async ({ asRole }) => {
  const page = await asRole("customer");
  const productListPage = new ProductListPage(page);

  await productListPage.navigateToProductListPage();
  await productListPage.sortBy("price_asc");

  expect(await productListPage.getDisplayedPrices()).toBeSorted("asc");
});
