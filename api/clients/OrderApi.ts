import { APIRequestContext } from "@playwright/test";
import { Order, OrderDetail, ShippingAddress } from "../models/order.models";
import {
  createOrderResponseSchema,
  orderDetailResponseSchema,
  orderListResponseSchema,
} from "../schemas/order.schema";
import { messageResponseSchema } from "../schemas/common.schema";

export class OrderApi {
  private readonly baseUrl: string;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.baseUrl = process.env.API_BASE_URL!;
    this.request = request;
  }

  private auth(accessToken: string) {
    return { Authorization: `Bearer ${accessToken}` };
  }

  async getOrders(accessToken: string): Promise<Order[]> {
    const response = await this.request.get(`${this.baseUrl}/api/orders`, {
      headers: this.auth(accessToken),
    });

    if (!response.ok()) {
      throw new Error(`Get orders failed. Status: ${response.status()}`);
    }

    return orderListResponseSchema.parse(await response.json()).orders;
  }

  async getOrder(accessToken: string, orderId: string): Promise<OrderDetail> {
    const response = await this.request.get(
      `${this.baseUrl}/api/orders/${orderId}`,
      { headers: this.auth(accessToken) },
    );

    if (!response.ok()) {
      throw new Error(`Get order failed. Status: ${response.status()}`);
    }

    return orderDetailResponseSchema.parse(await response.json()).order;
  }

  // Checks out whatever is in the user's cart, paying cash on delivery
  async placeCodOrder(
    accessToken: string,
    shippingAddress: ShippingAddress,
  ): Promise<Order> {
    const response = await this.request.post(`${this.baseUrl}/api/orders`, {
      headers: this.auth(accessToken),
      data: { shippingAddress, paymentMethod: "cod", deliveryMethod: "standard" },
    });

    if (!response.ok()) {
      throw new Error(`Place order failed. Status: ${response.status()}`);
    }

    return createOrderResponseSchema.parse(await response.json()).order;
  }

  async cancelOrder(accessToken: string, orderId: string, reason = "Test cleanup") {
    const response = await this.request.post(
      `${this.baseUrl}/api/orders/${orderId}/cancel`,
      { headers: this.auth(accessToken), data: { reason } },
    );

    if (!response.ok()) {
      throw new Error(`Cancel order failed. Status: ${response.status()}`);
    }

    return messageResponseSchema.parse(await response.json());
  }

  // The storefront has no "Return" button, so returns can only be requested via the API.
  // Raw response, so tests can check both the success and the rejection cases.
  async requestReturn(accessToken: string, orderId: string, reason: string) {
    return await this.request.post(
      `${this.baseUrl}/api/orders/${orderId}/return`,
      { headers: this.auth(accessToken), data: { reason } },
    );
  }
}
