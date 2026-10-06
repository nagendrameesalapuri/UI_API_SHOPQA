import { z } from "zod";
import { decimalStringSchema, idSchema, timestampSchema } from "./common.schema";

export const reviewSchema = z.object({
  id: idSchema,
  product_id: idSchema,
  user_id: idSchema,
  order_id: idSchema.nullable(),
  rating: z.number().int().min(1).max(5),
  title: z.string(),
  body: z.string(),
  images: z.array(z.string()).nullable(),
  status: z.string().min(1),
  helpful_count: z.number().int().nonnegative(),
  verified_purchase: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

// Review lists join in the author's name
export const reviewWithAuthorSchema = reviewSchema.extend({
  first_name: z.string(),
  last_name: z.string(),
  avatar_url: z.string().nullable(),
});

export const productReviewsResponseSchema = z.object({
  reviews: z.array(reviewWithAuthorSchema),
  total: z.number().int().nonnegative(),
  avgRating: z.number().min(0).max(5),
  distribution: z.array(
    z.object({
      rating: z.number().int().min(1).max(5),
      count: decimalStringSchema,
    }),
  ),
  page: z.number().int().positive(),
});

export const createReviewResponseSchema = z.object({
  review: reviewSchema,
});

export type Review = z.infer<typeof reviewSchema>;
export type ProductReviewsResponse = z.infer<typeof productReviewsResponseSchema>;
