import { test } from "../../../fixtures/ui.fixture";

const MIN_PRICE = 500;
const MAX_PRICE = 2000;
const NO_RESULTS_QUERY = "zzzxxyy";

test.describe("Product Catalog Tests", () => {
  test.describe.configure({ timeout: 120000 });

  test("@Regression TC-017 Filter by price range", async ({
    productListPage,
  }) => {
    await productListPage.navigateToProductListPage();
    await productListPage.filterByPriceRange(MIN_PRICE, MAX_PRICE);

    await productListPage.verifyUrlContains(`minPrice=${MIN_PRICE}`);
    await productListPage.verifyUrlContains(`maxPrice=${MAX_PRICE}`);
    await productListPage.verifyAllPricesWithin(MIN_PRICE, MAX_PRICE);
  });

  test("@Regression TC-018 Sort products", async ({ productListPage }) => {
    await productListPage.navigateToProductListPage();

    await test.step("Sort by Price: Low to High", async () => {
      await productListPage.sortBy("price_asc");
      await productListPage.verifyUrlContains("sort=price_asc");
      await productListPage.verifyPricesSorted("asc");
    });

    await test.step("Sort by Price: High to Low", async () => {
      await productListPage.sortBy("price_desc");
      await productListPage.verifyUrlContains("sort=price_desc");
      await productListPage.verifyPricesSorted("desc");
    });
  });

  test("@Regression TC-020 Search with no results", async ({
    productListPage,
  }) => {
    await productListPage.navigateToProductListPage();
    await productListPage.searchFor(NO_RESULTS_QUERY);

    await productListPage.verifyEmptyState();
  });

  test("@Regression TC-021 Out-of-stock product", async ({
    productListPage,
    outOfStockProduct,
  }) => {
    await productListPage.navigateToProductListPage();
    await productListPage.searchFor(outOfStockProduct.name);

    await productListPage.verifyProductOutOfStock(outOfStockProduct.id);
  });
});
