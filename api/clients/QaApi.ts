import { APIRequestContext } from "@playwright/test";
import { messageResponseSchema } from "../schemas/common.schema";
import {
  setStockResponseSchema,
  verificationTokenResponseSchema,
} from "../schemas/qa.schema";

export class QaApi {
  private readonly baseUrl: string;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.baseUrl = process.env.API_BASE_URL!;
    this.request = request;
  }

  async expireTokens(userId: string) {
    const response = await this.request.post(
      `${this.baseUrl}/api/qa/users/${userId}/expire-tokens`,
    );

    if (!response.ok()) {
      throw new Error(`Expire tokens failed. Status: ${response.status()}`);
    }

    return messageResponseSchema.parse(await response.json());
  }

  // Works in every environment, unlike the token echoed by registration in dev only
  async getVerificationToken(email: string): Promise<string> {
    const response = await this.request.get(
      `${this.baseUrl}/api/qa/users/${encodeURIComponent(email)}/verification-token`,
    );

    if (!response.ok()) {
      throw new Error(`Get verification token failed. Status: ${response.status()}`);
    }

    return verificationTokenResponseSchema.parse(await response.json())
      .verificationToken;
  }

  async setProductsOutOfStock(productIds: string[]) {
    const response = await this.request.post(
      `${this.baseUrl}/api/qa/products/out-of-stock`,
      { data: { productIds } },
    );

    if (!response.ok()) {
      throw new Error(`Set out of stock failed. Status: ${response.status()}`);
    }

    return messageResponseSchema.parse(await response.json());
  }

  async setProductStock(productId: string, stock: number) {
    const response = await this.request.patch(
      `${this.baseUrl}/api/qa/products/${productId}/stock`,
      { data: { stock } },
    );

    if (!response.ok()) {
      throw new Error(`Set product stock failed. Status: ${response.status()}`);
    }

    return setStockResponseSchema.parse(await response.json());
  }
}
