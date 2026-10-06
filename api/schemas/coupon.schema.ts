import { z } from "zod";
import { decimalStringSchema, idSchema, timestampSchema } from "./common.schema";

export const couponSchema = z.object({
  id: idSchema,
  code: z.string().min(1),
  description: z.string().nullable(),
  type: z.enum(["percentage", "fixed"]),
  value: decimalStringSchema,
  min_order_amt: decimalStringSchema,
  max_discount: decimalStringSchema.nullable(),
  usage_limit: z.number().int().nullable(),
  usage_count: z.number().int().nonnegative(),
  per_user_limit: z.number().int().nullable(),
  applicable_to: z.string().min(1),
  category_ids: z.array(idSchema).nullable(),
  product_ids: z.array(idSchema).nullable(),
  is_active: z.boolean(),
  starts_at: timestampSchema.nullable(),
  expires_at: timestampSchema.nullable(),
  created_by: idSchema.nullable(),
  created_at: timestampSchema,
});

export const adminCouponsResponseSchema = z.object({
  coupons: z.array(couponSchema),
});

export type Coupon = z.infer<typeof couponSchema>;
