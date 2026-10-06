import { test } from "../../../fixtures/api.fixture";
import { expectError } from "../../../utils/api-assertions";
import { UNKNOWN_ID } from "../../../test-data/api";

// Every admin endpoint must refuse guests (401) and customers (403)
const ADMIN_ENDPOINTS: [method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string][] = [
  ["GET", "admin/dashboard"],
  ["GET", "admin/users"],
  ["PATCH", `admin/users/${UNKNOWN_ID}`],
  ["GET", "admin/coupons"],
  ["POST", "admin/coupons"],
  ["PUT", `admin/coupons/${UNKNOWN_ID}`],
  ["DELETE", `admin/coupons/${UNKNOWN_ID}`],
  ["GET", "admin/analytics/revenue"],
  ["GET", "orders/admin/all"],
  ["PUT", `orders/admin/${UNKNOWN_ID}/status`],
  ["POST", "products"],
  ["PUT", `products/${UNKNOWN_ID}`],
  ["DELETE", `products/${UNKNOWN_ID}`],
  ["GET", "products/export/csv"],
];

const send = (
  api: import("../../../utils/request-handler").RequestHandler,
  method: string,
) => {
  switch (method) {
    case "POST":
      return api.body({}).postRequest();
    case "PUT":
      return api.body({}).putRequest();
    case "PATCH":
      return api.body({}).patchRequest();
    case "DELETE":
      return api.deleteRequest();
    default:
      return api.getRequest();
  }
};

test.describe("@API Admin - access control", () => {
  for (const [method, path] of ADMIN_ENDPOINTS) {
    test(`${method} /api/${path} refuses guests and customers`, async ({ api, accessToken }) => {
      await expectError(await send(api.path(path), method), 401, "MISSING_TOKEN");
      await expectError(await send(api.path(path).auth(accessToken), method), 403, "FORBIDDEN");
    });
  }
});
