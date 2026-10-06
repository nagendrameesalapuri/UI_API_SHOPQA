// Response types are inferred from the zod schemas so the two cannot drift apart
export type {
  Review,
  ProductReviewsResponse as ProductReviews,
} from "../schemas/review.schema";

export interface ReviewInput {
  rating: number;
  title: string;
  body: string;
}
