import { test, expect } from "../../../fixtures/api.fixture";
import { Cart } from "../../../api/models/cart.models";
import { expectError, expectStatus } from "../../../utils/api-assertions";
import {
  FREE_SHIPPING_THRESHOLD,
  roundMoney,
  STANDARD_SHIPPING,
  TAX_RATE,
  UNKNOWN_ID,
} from "../../../test-data/api";

// Atomic Habits costs 499: one copy pays shipping, two ship free
const PRODUCT_SLUG = "atomic-habits";
// Taken out of stock by one test only, then restored
const OUT_OF_STOCK_SLUG = "monopoly-board-game";

function verifyTotals(cart: Cart) {
  const subtotal = cart.items.reduce((sum, { price, quantity }) => sum + Number(price) * quantity, 0);
  expect(cart.subtotal).toBeCloseTo(subtotal, 2);
  for (const { price, quantity, item_total } of cart.items) {
    expect(Number(item_total)).toBeCloseTo(Number(price) * quantity, 2);
  }
  expect(cart.itemCount).toBe(cart.items.reduce((n, { quantity }) => n + quantity, 0));

  const expectedShipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING;
  expect(cart.shipping).toBe(expectedShipping);
  expect(cart.tax).toBeCloseTo(roundMoney((subtotal - cart.discount) * TAX_RATE), 2);
  expect(cart.total).toBeCloseTo(
    roundMoney(subtotal - cart.discount + cart.shipping + cart.tax),
    2,
  );
}

test.describe("@API Cart - access", () => {
  test("Cart requires login", async ({ api }) => {
    await expectError(await api.path("cart").getRequest(), 401, "MISSING_TOKEN");
  });

  test("Invalid token is rejected", async ({ api }) => {
    await expectError(await api.path("cart").auth("abc.def.ghi").getRequest(), 401, "INVALID_TOKEN");
  });
});

test.describe("@API Cart - items", () => {
  test("New user starts with an empty cart", async ({ cartApi, accessToken }) => {
    const cart = await cartApi.getCart(accessToken);
    expect(cart.items).toHaveLength(0);
    expect(cart.coupon).toBeNull();
    expect(cart.subtotal).toBe(0);
    // Today an empty cart still charges ₹49 shipping (total 49)
    expect(cart.shipping, "no shipping on an empty cart").toBe(0);
    expect(cart.total).toBe(0);
  });

  test("Adding the same product twice merges into one line", async ({
    cartApi,
    productApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct(PRODUCT_SLUG);
    await cartApi.addItem(accessToken, product.id, 2);
    await cartApi.addItem(accessToken, product.id, 1);

    const cart = await cartApi.getCart(accessToken);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ product_id: product.id, quantity: 3 });
    verifyTotals(cart);
  });

  test("Totals below the free-shipping threshold include shipping", async ({
    cartApi,
    productApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct(PRODUCT_SLUG);
    await cartApi.addItem(accessToken, product.id, 1);

    const cart = await cartApi.getCart(accessToken);
    expect(cart.shipping).toBe(STANDARD_SHIPPING);
    verifyTotals(cart);
  });

  test("Update quantity, remove an item, clear the cart", async ({
    api,
    cartApi,
    productApi,
    accessToken,
  }) => {
    const first = await productApi.getProduct(PRODUCT_SLUG);
    const second = await productApi.getProduct("dune");
    await cartApi.addItem(accessToken, first.id, 1);
    await cartApi.addItem(accessToken, second.id, 1);
    let cart = await cartApi.getCart(accessToken);
    const firstItem = cart.items.find(({ product_id }) => product_id === first.id)!;

    await test.step("Update quantity", async () => {
      await expectStatus(
        await api.path(`cart/items/${firstItem.id}`).auth(accessToken).body({ quantity: 4 }).putRequest(),
        200,
      );
      cart = await cartApi.getCart(accessToken);
      expect(cart.items.find(({ id }) => id === firstItem.id)!.quantity).toBe(4);
      verifyTotals(cart);
    });

    await test.step("Remove one item", async () => {
      await expectStatus(
        await api.path(`cart/items/${firstItem.id}`).auth(accessToken).deleteRequest(),
        200,
      );
      cart = await cartApi.getCart(accessToken);
      expect(cart.items.map(({ product_id }) => product_id)).toEqual([second.id]);
    });

    await test.step("Clear the cart", async () => {
      await expectStatus(await api.path("cart").auth(accessToken).deleteRequest(), 200);
      cart = await cartApi.getCart(accessToken);
      expect(cart.items).toHaveLength(0);
    });
  });
});

test.describe("@API Cart - stock and validation", () => {
  test("Adding more than the stock is refused", async ({ api, productApi, accessToken }) => {
    const product = await productApi.getProduct(PRODUCT_SLUG);
    const response = await api
      .path("cart/items")
      .auth(accessToken)
      .body({ productId: product.id, quantity: product.stock + 1 })
      .postRequest();

    const body = await expectError(response, 400, "INSUFFICIENT_STOCK");
    expect(body.available).toBe(product.stock);
  });

  test("Raising a line above the stock is refused", async ({
    api,
    cartApi,
    productApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct(PRODUCT_SLUG);
    await cartApi.addItem(accessToken, product.id, 1);
    const [item] = (await cartApi.getCart(accessToken)).items;

    const response = await api
      .path(`cart/items/${item.id}`)
      .auth(accessToken)
      .body({ quantity: product.stock + 1 })
      .putRequest();
    const body = await expectError(response, 400, "INSUFFICIENT_STOCK");
    expect(body.error).toBe(`Only ${product.stock} available`);
  });

  test("Out-of-stock product cannot be added", async ({
    api,
    productApi,
    qaApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct(OUT_OF_STOCK_SLUG);
    await qaApi.setProductStock(product.id, 0);
    try {
      const response = await api
        .path("cart/items")
        .auth(accessToken)
        .body({ productId: product.id, quantity: 1 })
        .postRequest();
      await expectError(response, 400, "OUT_OF_STOCK");
    } finally {
      await qaApi.setProductStock(product.id, product.stock);
    }
  });

  test("Unknown product returns 404", async ({ api, accessToken }) => {
    const response = await api
      .path("cart/items")
      .auth(accessToken)
      .body({ productId: UNKNOWN_ID, quantity: 1 })
      .postRequest();
    await expectError(response, 404, "PRODUCT_NOT_FOUND");
  });

  test("Missing productId is rejected", async ({ api, accessToken }) => {
    const response = await api.path("cart/items").auth(accessToken).body({}).postRequest();
    // Today the body is { error } with no code
    await expectError(response, 400);
  });

  test("Adding quantity 0 is rejected with 400", async ({ api, productApi, accessToken }) => {
    const product = await productApi.getProduct(PRODUCT_SLUG);
    const response = await api
      .path("cart/items")
      .auth(accessToken)
      .body({ productId: product.id, quantity: 0 })
      .postRequest();
    // Today: 500 with a raw database check-constraint error
    await expectError(response, 400);
  });

  test("Updating a line to quantity 0 is rejected with 400", async ({
    api,
    cartApi,
    productApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct(PRODUCT_SLUG);
    await cartApi.addItem(accessToken, product.id, 1);
    const [item] = (await cartApi.getCart(accessToken)).items;

    const response = await api
      .path(`cart/items/${item.id}`)
      .auth(accessToken)
      .body({ quantity: 0 })
      .putRequest();
    // Today: 500 with a raw database check-constraint error
    await expectError(response, 400);
  });

  test("Another user's cart item cannot be changed", async ({
    api,
    cartApi,
    productApi,
    accessToken,
    secondUser,
  }) => {
    const product = await productApi.getProduct(PRODUCT_SLUG);
    await cartApi.addItem(accessToken, product.id, 1);
    const [item] = (await cartApi.getCart(accessToken)).items;

    await expectStatus(
      await api.path(`cart/items/${item.id}`).auth(secondUser.accessToken).body({ quantity: 2 }).putRequest(),
      404,
    );
    const deleteAttempt = await api
      .path(`cart/items/${item.id}`)
      .auth(secondUser.accessToken)
      .deleteRequest();

    // The item survives untouched (today the delete still answers 200 "Item removed")
    expect((await cartApi.getCart(accessToken)).items).toEqual([item]);
    expect(deleteAttempt.status(), "delete of someone else's cart item should be 404").toBe(404);
  });
});
