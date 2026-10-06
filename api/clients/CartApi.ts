import { APIRequestContext } from "@playwright/test";
import { Cart } from "../models/cart.models";
import { cartResponseSchema } from "../schemas/cart.schema";
import { messageResponseSchema } from "../schemas/common.schema";

export class CartApi {
  private readonly baseUrl: string;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.baseUrl = process.env.API_BASE_URL!;
    this.request = request;
  }

  async getCart(accessToken: string): Promise<Cart> {
    const response = await this.request.get(`${this.baseUrl}/api/cart`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok()) {
      throw new Error(`Get cart failed. Status: ${response.status()}`);
    }

    return cartResponseSchema.parse(await response.json()).cart;
  }

  async addItem(accessToken: string, productId: string, quantity: number) {
    const response = await this.request.post(`${this.baseUrl}/api/cart/items`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { productId, quantity },
    });

    if (!response.ok()) {
      throw new Error(`Add cart item failed. Status: ${response.status()}`);
    }

    return messageResponseSchema.parse(await response.json());
  }
}
