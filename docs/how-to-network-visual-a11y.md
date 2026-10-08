# How to use network mocking, HAR replay, visual checks and accessibility checks

All three are fixtures available from `src/fixtures` (`network`, `a11y`) and Playwright's built-in
`toHaveScreenshot`. They are opt-in per test; the existing suites don't use them yet.

## Network control (`network` fixture)

```ts
import { test } from "../../src/fixtures";

test("cart shows an error when the API is down", async ({ network, cartPage }) => {
  await network.fail(/\/api\/cart$/, 503); // simulate a backend outage
  await cartPage.navigateToCartPage();
  // ...assert the error banner through the page object
});
```

| Method                                  | Use                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `mockJson(url, body, status?, method?)` | Answer with fixed JSON; `method` limits it to e.g. `POST`; later routes override earlier ones |
| `fail(url, status)`                     | Error response with `{ success: false, message }`                                             |
| `abort(url)`                            | Network failure (`net::ERR_FAILED`)                                                           |
| `patchJson(url, fn)`                    | Real response with a modified body (e.g. force `stock: 0`)                                    |
| `replayHar(path, url, update?)`         | HAR record/replay                                                                             |

### HAR record / replay example

```ts
test("catalog renders from recorded traffic", async ({ network, productListPage }) => {
  // 1st run with update=true records tests/fixtures-har/catalog.har from the real API,
  // commit the file, then switch to update=false to replay offline and deterministically.
  await network.replayHar("tests/fixtures-har/catalog.har", /\/api\/products/, false);
  await productListPage.navigateToProductListPage();
});
```

Re-record when the API contract changes. HAR files can contain personal data: record with test users only.

## Visual testing

```ts
test("@visual product detail layout", async ({ page, productDetailPage }) => {
  await productDetailPage.navigateToProduct("atomic-habits", "Atomic Habits");
  await expect(page).toHaveScreenshot("product-detail.png", {
    // Mask dynamic content (prices, stock, review dates) with page-object locators
    mask: [page.getByTestId("quantity-value")],
    fullPage: true,
  });
});
```

- Config: `maxDiffPixelRatio: 0.01`, animations disabled, baselines in `tests/__screenshots__/…-<project>.png`.
- **Generate and update baselines inside Docker only** (`npm run docker:test -- npx playwright test --grep @visual --update-snapshots`)
  so fonts and rendering match CI. Baselines made on Windows/macOS will not match Linux agents.

## Accessibility (`a11y` fixture)

```ts
test("@a11y checkout page", async ({ a11y, checkoutPage }) => {
  await checkoutPage.navigateToCheckoutPage();
  await a11y.check({ exclude: ["#third-party-chat"] });
});
```

Runs axe-core with WCAG 2 A + AA, attaches the full JSON report to the test, and fails only on
**serious** and **critical** violations. The dashboard tests use it (it caught two colour-contrast
issues during development).

## Flaky handling

- CI retries: 2 (`playwright.config.ts`); a test that passes on retry is reported as _flaky_ and the
  triage marks it FLAKY.
- Tag a known-flaky test `@quarantine` in its title: excluded from all runs by default (`grepInvert`),
  run on purpose with `INCLUDE_QUARANTINE=true`. Quarantine is temporary: open a ticket with it.
