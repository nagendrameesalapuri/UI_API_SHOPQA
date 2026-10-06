import { APIRequestContext } from "@playwright/test";
import { messageResponseSchema } from "../schemas/common.schema";
import { wishlistResponseSchema } from "../schemas/user.schema";

export class WishlistApi {
  private readonly baseUrl: string;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.baseUrl = process.env.API_BASE_URL!;
    this.request = request;
  }

  async addItem(accessToken: string, productId: string) {
    const response = await this.request.post(
      `${this.baseUrl}/api/users/wishlist`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { productId },
      },
    );

    if (!response.ok()) {
      throw new Error(`Add wishlist item failed. Status: ${response.status()}`);
    }

    return messageResponseSchema.parse(await response.json());
  }

  async getWishlist(accessToken: string) {
    const response = await this.request.get(
      `${this.baseUrl}/api/users/wishlist`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok()) {
      throw new Error(`Get wishlist failed. Status: ${response.status()}`);
    }

    return wishlistResponseSchema.parse(await response.json()).wishlist;
  }
}
