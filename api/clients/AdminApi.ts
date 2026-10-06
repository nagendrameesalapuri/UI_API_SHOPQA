import { APIRequestContext } from "@playwright/test";
import { Order, OrderStatus } from "../models/order.models";
import {
  adminUsersResponseSchema,
  adminUserUpdateResponseSchema,
  dashboardResponseSchema,
} from "../schemas/admin.schema";
import { messageResponseSchema } from "../schemas/common.schema";
import { adminCouponsResponseSchema } from "../schemas/coupon.schema";
import { orderStatusUpdateResponseSchema } from "../schemas/order.schema";
import {
  categoriesResponseSchema,
  productWriteResponseSchema,
} from "../schemas/product.schema";

export interface NewProduct {
  name: string;
  price: number;
  stock: number;
  categorySlug: string;
  brand: string;
  description: string;
}

// Admin-only endpoints; every call needs an admin access token
export class AdminApi {
  private readonly baseUrl: string;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.baseUrl = process.env.API_BASE_URL!;
    this.request = request;
  }

  private auth(accessToken: string) {
    return { Authorization: `Bearer ${accessToken}` };
  }

  async getCategoryId(slug: string): Promise<string> {
    const response = await this.request.get(
      `${this.baseUrl}/api/products/categories`,
    );
    const { categories } = categoriesResponseSchema.parse(await response.json());
    const category = categories.find((c) => c.slug === slug);
    if (!category) {
      throw new Error(`Category "${slug}" not found`);
    }
    return category.id;
  }

  async createProduct(accessToken: string, product: NewProduct) {
    const response = await this.request.post(`${this.baseUrl}/api/products`, {
      headers: this.auth(accessToken),
      multipart: {
        name: product.name,
        price: String(product.price),
        stock: String(product.stock),
        categoryId: await this.getCategoryId(product.categorySlug),
        brand: product.brand,
        description: product.description,
        isFeatured: "false",
      },
    });

    if (!response.ok()) {
      throw new Error(`Create product failed. Status: ${response.status()}`);
    }

    return productWriteResponseSchema.parse(await response.json()).product;
  }

  async updateProduct(
    accessToken: string,
    productId: string,
    changes: Partial<Pick<NewProduct, "name" | "price" | "stock" | "brand" | "description">>,
  ) {
    const response = await this.request.put(`${this.baseUrl}/api/products/${productId}`, {
      headers: this.auth(accessToken),
      data: changes,
    });

    if (!response.ok()) {
      throw new Error(`Update product failed. Status: ${response.status()}`);
    }

    return productWriteResponseSchema.parse(await response.json()).product;
  }

  // DELETE only deactivates: the product drops out of the catalog but keeps its row
  async deactivateProduct(accessToken: string, productId: string) {
    const response = await this.request.delete(
      `${this.baseUrl}/api/products/${productId}`,
      { headers: this.auth(accessToken) },
    );

    if (!response.ok()) {
      throw new Error(`Deactivate product failed. Status: ${response.status()}`);
    }

    return messageResponseSchema.parse(await response.json());
  }

  async updateOrderStatus(
    accessToken: string,
    orderId: string,
    status: OrderStatus,
  ): Promise<Order> {
    const response = await this.request.put(
      `${this.baseUrl}/api/orders/admin/${orderId}/status`,
      { headers: this.auth(accessToken), data: { status } },
    );

    if (!response.ok()) {
      throw new Error(`Update order status failed. Status: ${response.status()}`);
    }

    return orderStatusUpdateResponseSchema.parse(await response.json()).order;
  }

  async getCoupons(accessToken: string) {
    const response = await this.request.get(`${this.baseUrl}/api/admin/coupons`, {
      headers: this.auth(accessToken),
    });

    if (!response.ok()) {
      throw new Error(`Get coupons failed. Status: ${response.status()}`);
    }

    return adminCouponsResponseSchema.parse(await response.json()).coupons;
  }

  // A coupon referenced by a cart or an order cannot be deleted (the API
  // answers 500 with a foreign-key error), so fall back to disabling it
  async deleteOrDisableCoupon(accessToken: string, code: string) {
    const coupon = (await this.getCoupons(accessToken)).find((c) => c.code === code);
    if (!coupon) return;

    const deleted = await this.request.delete(
      `${this.baseUrl}/api/admin/coupons/${coupon.id}`,
      { headers: this.auth(accessToken) },
    );
    if (deleted.ok()) return;

    const disabled = await this.request.put(
      `${this.baseUrl}/api/admin/coupons/${coupon.id}`,
      { headers: this.auth(accessToken), data: { isActive: false } },
    );
    if (!disabled.ok()) {
      throw new Error(`Disable coupon failed. Status: ${disabled.status()}`);
    }
  }

  async getUsers(accessToken: string, search: string) {
    const response = await this.request.get(`${this.baseUrl}/api/admin/users`, {
      headers: this.auth(accessToken),
      params: { search },
    });

    if (!response.ok()) {
      throw new Error(`Get users failed. Status: ${response.status()}`);
    }

    return adminUsersResponseSchema.parse(await response.json());
  }

  async setUserStatus(accessToken: string, userId: string, status: string) {
    const response = await this.request.patch(
      `${this.baseUrl}/api/admin/users/${userId}`,
      { headers: this.auth(accessToken), data: { status } },
    );

    if (!response.ok()) {
      throw new Error(`Update user status failed. Status: ${response.status()}`);
    }

    return adminUserUpdateResponseSchema.parse(await response.json()).user;
  }

  // Raw response, so tests can also check that non-admins get 403
  async getDashboard(accessToken: string) {
    return await this.request.get(`${this.baseUrl}/api/admin/dashboard`, {
      headers: this.auth(accessToken),
    });
  }

  async getDashboardStats(accessToken: string) {
    const response = await this.getDashboard(accessToken);

    if (!response.ok()) {
      throw new Error(`Get dashboard failed. Status: ${response.status()}`);
    }

    return dashboardResponseSchema.parse(await response.json());
  }
}
