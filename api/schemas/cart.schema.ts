import { z } from "zod";
import { decimalStringSchema, idSchema, timestampSchema } from "./common.schema";
import { couponSchema } from "./coupon.schema";

export const cartItemSchema = z.object({
  id: idSchema,
  cart_id: idSchema,
  product_id: idSchema,
  variant_id: idSchema.nullable(),
  quantity: z.number().int().positive(),
  price: decimalStringSchema,
  added_at: timestampSchema,
  name: z.string().min(1),
  thumbnail: z.string().nullable(),
  stock: z.number().int().nonnegative(),
  item_total: decimalStringSchema,
});

// Unlike most endpoints, cart totals are plain numbers
export const cartSchema = z.object({
  id: idSchema,
  items: z.array(cartItemSchema),
  coupon: couponSchema.nullable(),
  subtotal: z.number().nonnegative(),
  discount: z.number().nonnegative(),
  shipping: z.number().nonnegative(),
  tax: z.number().nonnegative(),
  total: z.number().nonnegative(),
  itemCount: z.number().int().nonnegative(),
});

export const cartResponseSchema = z.object({
  cart: cartSchema,
});

export const applyCouponResponseSchema = z.object({
  message: z.literal("Coupon applied"),
  coupon: z.object({
    code: z.string().min(1),
    type: z.enum(["percentage", "fixed"]),
    value: decimalStringSchema,
    discount: z.number().nonnegative(),
  }),
});

export type CartItem = z.infer<typeof cartItemSchema>;
export type Cart = z.infer<typeof cartSchema>;
