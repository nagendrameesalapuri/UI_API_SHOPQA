import { test, expect } from "../../../fixtures/api.fixture";
import { expectError, expectStatus } from "../../../utils/api-assertions";
import { UNKNOWN_ID } from "../../../test-data/api";
import { ProductSort } from "../../../api/models/product.models";

const isSorted = (values: number[], direction: "asc" | "desc") =>
  values.every(
    (v, i) => i === 0 || (direction === "asc" ? values[i - 1] <= v : values[i - 1] >= v),
  );

test.describe("@API Products - listing", () => {
  test("Pagination splits the catalog into consistent pages", async ({ productApi }) => {
    const first = await productApi.listProducts({ page: 1, limit: 5 });
    expect(first.products).toHaveLength(5);
    expect(first.pages).toBe(Math.ceil(first.total / 5));
    expect(first.hasPrev).toBe(false);
    expect(first.hasNext).toBe(true);

    const second = await productApi.listProducts({ page: 2, limit: 5 });
    expect(second.hasPrev).toBe(true);
    const firstIds = first.products.map(({ id }) => id);
    expect(second.products.every(({ id }) => !firstIds.includes(id))).toBe(true);

    const last = await productApi.listProducts({ page: first.pages, limit: 5 });
    expect(last.hasNext).toBe(false);
    expect(last.products).toHaveLength(first.total - 5 * (first.pages - 1));
  });

  test("A page past the end is empty", async ({ productApi }) => {
    const beyond = await productApi.listProducts({ page: 9999, limit: 12 });
    expect(beyond.products).toHaveLength(0);
    expect(beyond.hasNext).toBe(false);
    expect(beyond.hasPrev).toBe(true);
  });

  test("limit=0 still returns consistent pagination", async ({ api }) => {
    const body = await expectStatus(
      await api.path("products").params({ limit: 0 }).getRequest(),
      200,
    );
    // Today: { pages: null, hasNext: true } with no products
    expect(body.pages, "pages must be a number").toEqual(expect.any(Number));
    expect(body.hasNext).toBe(false);
  });

  test("Search matches by name, ignoring whitespace", async ({ productApi }) => {
    const { products } = await productApi.listProducts({ search: "i phone" });
    expect(products.map(({ name }) => name)).toContain("iPhone 15 Pro");
  });

  test("Search matches by brand", async ({ productApi }) => {
    const { products } = await productApi.listProducts({ search: "Apple", limit: 50 });
    expect(products.length).toBeGreaterThan(0);
    expect(products.every(({ brand }) => brand === "Apple")).toBe(true);
  });

  test("Category filter returns only that category", async ({ productApi }) => {
    const { products, total } = await productApi.listProducts({
      category: "books",
      limit: 50,
    });
    expect(total).toBeGreaterThan(0);
    expect(products.every(({ category_slug }) => category_slug === "books")).toBe(true);
  });

  test("Price range filter is inclusive", async ({ productApi }) => {
    const { products } = await productApi.listProducts({
      minPrice: 500,
      maxPrice: 2000,
      limit: 100,
    });
    expect(products.length).toBeGreaterThan(0);
    for (const { name, price } of products) {
      expect(Number(price), name).toBeGreaterThanOrEqual(500);
      expect(Number(price), name).toBeLessThanOrEqual(2000);
    }
  });

  test("An impossible price range returns nothing", async ({ productApi }) => {
    const { products, total } = await productApi.listProducts({
      minPrice: 5000,
      maxPrice: 100,
    });
    expect(total).toBe(0);
    expect(products).toHaveLength(0);
  });

  test("Rating, stock and featured filters", async ({ productApi }) => {
    const rated = await productApi.listProducts({ rating: 4, limit: 100 });
    expect(rated.products.every(({ avg_rating }) => Number(avg_rating) >= 4)).toBe(true);

    const inStock = await productApi.listProducts({ inStock: true, limit: 100 });
    expect(inStock.products.every(({ stock }) => stock > 0)).toBe(true);

    const featured = await productApi.listProducts({ featured: true, limit: 100 });
    expect(featured.products.length).toBeGreaterThan(0);
    expect(featured.products.every(({ is_featured }) => is_featured)).toBe(true);
  });

  const numericSorts: [
    ProductSort,
    "asc" | "desc",
    (p: { price: string; avg_rating: string }) => number,
  ][] = [
    ["price_asc", "asc", ({ price }) => Number(price)],
    ["price_desc", "desc", ({ price }) => Number(price)],
    ["rating_desc", "desc", ({ avg_rating }) => Number(avg_rating)],
  ];
  for (const [sort, direction, value] of numericSorts) {
    test(`Sort ${sort}`, async ({ productApi }) => {
      const { products } = await productApi.listProducts({ sort, limit: 100 });
      expect(isSorted(products.map(value), direction)).toBe(true);
    });
  }

  test("Sort newest", async ({ productApi }) => {
    const { products } = await productApi.listProducts({ sort: "newest", limit: 100 });
    expect(
      isSorted(
        products.map(({ created_at }) => Date.parse(created_at)),
        "desc",
      ),
    ).toBe(true);
  });

  test("Sort name_asc", async ({ productApi }) => {
    const { products } = await productApi.listProducts({ sort: "name_asc", limit: 100 });
    const names = products.map(({ name }) => name.toLowerCase());
    expect(names).toEqual([...names].sort());
  });
});

test.describe("@API Products - detail and categories", () => {
  test("Product is the same by slug and by id", async ({ productApi }) => {
    const bySlug = await productApi.getProduct("iphone-15-pro");
    const byId = await productApi.getProduct(bySlug.id);
    expect(byId).toEqual(bySlug);
  });

  test("Detail includes reviews and related products from the same category", async ({
    productApi,
  }) => {
    const product = await productApi.getProduct("dune");
    expect(product.reviews).toHaveLength(Math.min(product.review_count, product.reviews.length));
    expect(product.reviews.every(({ product_id }) => product_id === product.id)).toBe(true);
    expect(product.related.length).toBeGreaterThan(0);
    expect(product.related.map(({ id }) => id)).not.toContain(product.id);
  });

  test("Unknown product returns 404 by slug and by id", async ({ api }) => {
    await expectError(
      await api.path("products/no-such-product-xyz").getRequest(),
      404,
      "PRODUCT_NOT_FOUND",
    );
    await expectError(
      await api.path(`products/${UNKNOWN_ID}`).getRequest(),
      404,
      "PRODUCT_NOT_FOUND",
    );
  });

  test("Each category's product_count matches the catalog", async ({ productApi }) => {
    const categories = await productApi.getCategories();
    expect(new Set(categories.map(({ slug }) => slug)).size).toBe(categories.length);

    for (const { slug, product_count } of categories) {
      const { total } = await productApi.listProducts({ category: slug, limit: 1 });
      expect(total, slug).toBe(Number(product_count));
    }
  });

  test("CSV export requires authentication", async ({ api }) => {
    await expectError(await api.path("products/export/csv").getRequest(), 401, "MISSING_TOKEN");
  });
});
