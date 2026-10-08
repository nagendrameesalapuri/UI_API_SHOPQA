import { expect, test } from "@playwright/test";

// DELIBERATELY BROKEN demo suite: one failure per triage category, fully offline
// (setContent + route, no real backend). It produces a realistic results.json to
// exercise `npm run triage` end to end:
//
//   npx playwright test --config ai/evals/broken-suite/playwright.config.ts
//   npm run triage -- --results ai/evals/broken-suite/results.json --out reports/broken-demo
//
// It lives outside tests/ so it never runs with the real suites.

const API = "https://shop.example.test";

async function callApi(
  page: import("@playwright/test").Page,
  path: string,
  status: number,
  body = "",
) {
  await page.route(`${API}${path}`, (route) => route.fulfill({ status, body }));
  await page.goto("about:blank");
  return page.evaluate(async (url) => {
    const r = await fetch(url);
    return { status: r.status, text: await r.text() };
  }, `${API}${path}`);
}

test("@Regression @TC-9001 flaky: passes on retry", async ({ page }, testInfo) => {
  await page.setContent(`<p data-testid="msg">${testInfo.retry === 0 ? "loading" : "ready"}</p>`);
  await expect(page.getByTestId("msg")).toHaveText("ready", { timeout: 500 });
});

test("@Regression @TC-9002 environment: backend unreachable", async ({ page }) => {
  await test.step("Open the storefront", async () => {
    await page.goto("http://127.0.0.1:9/products", { timeout: 5000 });
  });
});

test("@Regression @TC-9003 environment: backend 503", async ({ page }) => {
  await test.step("Load the cart", async () => {
    const res = await callApi(page, "/api/cart", 503, "Service Unavailable");
    if (res.status !== 200) throw new Error(`Get cart failed. Status: ${res.status}`);
  });
});

test("@Regression @TC-9004 environment: token rejected", async ({ page }) => {
  const res = await callApi(page, "/api/orders", 401, '{"code":"TOKEN_EXPIRED"}');
  expect(res.status, `GET ${API}/api/orders -> ${res.text}`).toBe(200);
});

test("@Regression @TC-9005 test issue: locator not found", async ({ page }) => {
  await page.setContent(`<button data-testid="btn-checkout-v2">Checkout</button>`);
  await test.step("Proceed to checkout", async () => {
    await page.getByTestId("btn-checkout").click({ timeout: 1500 });
  });
});

test("@Regression @TC-9006 test issue: strict mode violation", async ({ page }) => {
  await page.setContent(`<button>Add to cart</button><button>Add to cart</button>`);
  await page.getByRole("button", { name: "Add to cart" }).click({ timeout: 1500 });
});

test("@Regression @TC-9007 product bug: wrong order total", async ({ page }) => {
  await page.setContent(`<span data-testid="order-total">₹1,990</span>`);
  await test.step("Verify the order total after the FLAT500 coupon", async () => {
    await expect(page.getByTestId("order-total")).toHaveText("₹1,490", { timeout: 1000 });
  });
});

test("@Regression @TC-9008 test data: duplicate user", async ({ page }) => {
  const res = await callApi(
    page,
    "/api/auth/register",
    409,
    '{"code":"EMAIL_TAKEN","error":"Email already exists"}',
  );
  expect(res.status, `POST ${API}/api/auth/register -> ${res.status} ${res.text}`).toBe(201);
});

test("@Regression unknown: unexpected error", async () => {
  throw new Error("Cannot read properties of undefined (reading 'items')");
});

test("@Regression @TC-9010 timeout: never-ending wait", async ({ page }) => {
  test.setTimeout(3000);
  await page.setContent(`<p>No download link here</p>`);
  await page.waitForEvent("download");
});

test("@Regression @TC-9011 passes", async ({ page }) => {
  await page.setContent(`<h1>OK</h1>`);
  await expect(page.getByRole("heading")).toHaveText("OK");
});
