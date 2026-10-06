import { test, expect } from "@playwright/test";
import { ProductApi } from "../../../api/clients/ProductApi";

test("Get products with default pagination", async ({ request }) => {
  const productApi = new ProductApi(request);

  const response = await productApi.getProducts({
    page: 1,
    limit: 12,
    search: "Canon EOS R50",
    inStock: true,
    sort: "price_asc",
  });

  expect(response.status()).toBe(200);
  const body = await response.json();
  console.log(body);
  console.log(response);
});
