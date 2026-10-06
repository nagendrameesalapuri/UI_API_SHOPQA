import { APIRequestContext } from "@playwright/test";
import { ProductReviews } from "../models/review.models";
import { messageResponseSchema } from "../schemas/common.schema";
import { productReviewsResponseSchema } from "../schemas/review.schema";

export class ReviewApi {
  private readonly baseUrl: string;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.baseUrl = process.env.API_BASE_URL!;
    this.request = request;
  }

  async getReviews(productId: string): Promise<ProductReviews> {
    const response = await this.request.get(`${this.baseUrl}/api/reviews`, {
      params: { productId },
    });

    if (!response.ok()) {
      throw new Error(`Get reviews failed. Status: ${response.status()}`);
    }

    return productReviewsResponseSchema.parse(await response.json());
  }

  async deleteReview(reviewId: string, accessToken: string) {
    const response = await this.request.delete(
      `${this.baseUrl}/api/reviews/${reviewId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok()) {
      throw new Error(`Delete review failed. Status: ${response.status()}`);
    }

    return messageResponseSchema.parse(await response.json());
  }
}
