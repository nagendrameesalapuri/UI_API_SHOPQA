import { test, expect } from "../../../fixtures/api.fixture";
import { expectStatus } from "../../../utils/api-assertions";

test.describe("@API Admin - dashboard and reports", () => {
  test("Dashboard stats", async ({ adminApi, productApi, adminAccessToken }) => {
    const { stats, recentOrders, salesChart } = await adminApi.getDashboardStats(adminAccessToken);

    const { total } = await productApi.listProducts({ limit: 1 });
    expect(Number(stats.total_products)).toBeGreaterThanOrEqual(total);
    expect(Number(stats.revenue_month)).toBeLessThanOrEqual(Number(stats.total_revenue));
    expect(Number(stats.pending_orders)).toBeLessThanOrEqual(Number(stats.total_orders));

    const created = recentOrders.map(({ created_at }) => Date.parse(created_at));
    expect(created).toEqual([...created].sort((a, b) => b - a));
    expect(salesChart.length).toBeGreaterThan(0);
  });

  for (const period of ["7d", "30d", "90d"]) {
    test(`Revenue analytics for ${period}`, async ({ api, adminAccessToken }) => {
      const body = await expectStatus(
        await api.path("admin/analytics/revenue").auth(adminAccessToken).params({ period }).getRequest(),
        200,
      );
      expect(body.period).toBe(period);
      const oldest = Date.now() - parseInt(period) * 24 * 60 * 60 * 1000;
      for (const { date, revenue, orders } of body.data) {
        expect(Date.parse(date)).toBeGreaterThanOrEqual(oldest - 24 * 60 * 60 * 1000);
        expect(Number(revenue)).toBeGreaterThanOrEqual(0);
        expect(Number(orders)).toBeGreaterThan(0);
      }
    });
  }

  test("Product CSV export", async ({ api, productApi, adminAccessToken }) => {
    const response = await api.path("products/export/csv").auth(adminAccessToken).getRequest();
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");

    const [header, ...rows] = (await response.text()).trim().split("\n");
    expect(header).toBe("id,name,sku,price,stock,brand,category,featured,active,created_at");

    const product = await productApi.getProduct("iphone-15-pro");
    const row = rows.find((line) => line.startsWith(`${product.id},`));
    expect(row).toContain(`,${product.sku},${product.price},`);
  });
});
