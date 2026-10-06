import { test, expect } from "../../../fixtures/api.fixture";
import { expectError, expectStatus } from "../../../utils/api-assertions";
import { UNKNOWN_ID } from "../../../test-data/api";

const newProduct = (prefix: string) => ({
  name: `${prefix} ${Date.now()}`,
  price: 1499,
  stock: 12,
  categorySlug: "home-kitchen",
  brand: "QA Brand",
  description: "Created by the API admin suite.",
});

test.describe("@API Admin - products", () => {
  test("Created product is listed in the catalog", async ({
    adminApi,
    productApi,
    adminAccessToken,
    productsToDeactivate,
  }) => {
    const input = newProduct("QA API Lamp");
    const created = await adminApi.createProduct(adminAccessToken, input);
    productsToDeactivate.push(created.id);

    expect(created).toMatchObject({
      name: input.name,
      price: "1499.00",
      stock: 12,
      brand: "QA Brand",
      is_active: true,
    });
    expect(created.slug).toMatch(/^qa-api-lamp-/);

    const { products } = await productApi.listProducts({ search: input.name });
    expect(products.map(({ id }) => id)).toEqual([created.id]);
    expect(products[0].category_slug).toBe("home-kitchen");
  });

  test("Update price and stock", async ({
    adminApi,
    productApi,
    adminAccessToken,
    productsToDeactivate,
  }) => {
    const created = await adminApi.createProduct(adminAccessToken, newProduct("QA API Kettle"));
    productsToDeactivate.push(created.id);

    const updated = await adminApi.updateProduct(adminAccessToken, created.id, { price: 1299, stock: 4 });
    expect(updated).toMatchObject({ price: "1299.00", stock: 4 });

    const stored = await productApi.getProduct(created.id);
    expect(stored).toMatchObject({ price: "1299.00", stock: 4 });
  });

  test("Deactivated product leaves the catalog and cannot be bought", async ({
    api,
    adminApi,
    productApi,
    adminAccessToken,
    accessToken,
  }) => {
    const created = await adminApi.createProduct(adminAccessToken, newProduct("QA API Mug"));

    const body = await adminApi.deactivateProduct(adminAccessToken, created.id);
    expect(body.message).toBe("Product deactivated successfully");

    const { total } = await productApi.listProducts({ search: created.name });
    expect(total).toBe(0);
    const addToCart = await api
      .path("cart/items")
      .auth(accessToken)
      .body({ productId: created.id, quantity: 1 })
      .postRequest();
    await expectError(addToCart, 404, "PRODUCT_NOT_FOUND");
  });

  test("Updating an unknown product returns 404", async ({ api, adminAccessToken }) => {
    const response = await api
      .path(`products/${UNKNOWN_ID}`)
      .auth(adminAccessToken)
      .body({ price: 100 })
      .putRequest();
    await expectStatus(response, 404);
  });

  // When the API wrongly accepts an invalid product it is live in the shared
  // catalog, where it breaks other suites' listings; deactivate it at once,
  // before any assertion, so it is visible for as short a time as possible
  async function createAndRemoveIfAccepted(
    api: import("../../../utils/request-handler").RequestHandler,
    adminApi: import("../../../api/clients/AdminApi").AdminApi,
    adminAccessToken: string,
    body: object,
  ) {
    const response = await api.path("products").auth(adminAccessToken).body(body).postRequest();
    if (response.status() === 201) {
      // Read only the id: the invalid product would (rightly) fail the full schema
      const { product } = (await response.json()) as { product: { id: string } };
      await adminApi.deactivateProduct(adminAccessToken, product.id);
    }
    return response;
  }

  test("Product without a price is rejected", async ({ api, adminApi, adminAccessToken }) => {
    const response = await createAndRemoveIfAccepted(api, adminApi, adminAccessToken, {
      name: `QA API No Price ${Date.now()}`,
    });
    // Today: 201, saved with price "NaN" and no category
    expect(response.status(), "a product needs a price").toBe(400);
  });

  test("Negative price is rejected", async ({ api, adminApi, adminAccessToken }) => {
    const categoryId = await adminApi.getCategoryId("home-kitchen");
    const response = await createAndRemoveIfAccepted(api, adminApi, adminAccessToken, {
      name: `QA API Negative ${Date.now()}`,
      price: -5,
      stock: 1,
      categoryId,
    });
    // Today: 201, saved with price "-5.00"
    expect(response.status(), "prices cannot be negative").toBe(400);
  });
});
