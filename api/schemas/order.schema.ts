import { z } from "zod";
import {
  decimalStringSchema,
  errorResponseSchema,
  idSchema,
  timestampSchema,
} from "./common.schema";

// Statuses offered by the admin panel, plus the one a return request sets
export const orderStatusSchema = z.enum([
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
  "returned",
  "return_requested",
]);

export const paymentMethodSchema = z.enum([
  "credit_card",
  "debit_card",
  "upi",
  "paypal",
  "cod",
]);

export const deliveryMethodSchema = z.enum([
  "standard",
  "express",
  "overnight",
  "pickup",
]);

// Stored as sent at checkout, so it keeps the camelCase request keys
export const orderShippingAddressSchema = z.object({
  label: z.string().optional(),
  fullName: z.string().min(1),
  phone: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(1),
});

export const orderSchema = z.object({
  id: idSchema,
  // Checkout makes "ORD-MUS7E1M2-DPVJ"; the QA order generator "ORD-MUS9TNLP0"
  order_number: z.string().regex(/^ORD-[A-Z0-9-]+$/),
  user_id: idSchema,
  status: orderStatusSchema,
  payment_status: z.string().min(1),
  payment_method: paymentMethodSchema,
  payment_ref: z.string().nullable(),
  delivery_method: deliveryMethodSchema,
  shipping_address: orderShippingAddressSchema,
  subtotal: decimalStringSchema,
  discount_amt: decimalStringSchema,
  shipping_cost: decimalStringSchema,
  tax_amt: decimalStringSchema,
  total: decimalStringSchema,
  coupon_id: idSchema.nullable(),
  // Left null by the API even when a coupon was applied; coupon_id is reliable
  coupon_code: z.string().nullable(),
  notes: z.string().nullable(),
  tracking_number: z.string().nullable(),
  estimated_delivery: timestampSchema.nullable(),
  delivered_at: timestampSchema.nullable(),
  cancelled_at: timestampSchema.nullable(),
  cancel_reason: z.string().nullable(),
  return_reason: z.string().nullable(),
  invoice_url: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const orderItemSchema = z.object({
  id: idSchema,
  order_id: idSchema,
  product_id: idSchema,
  variant_id: idSchema.nullable(),
  product_name: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: decimalStringSchema,
  total_price: decimalStringSchema,
  image_url: z.string().nullable(),
});

export const orderHistoryEntrySchema = z.object({
  id: idSchema,
  order_id: idSchema,
  status: orderStatusSchema,
  comment: z.string().nullable(),
  updated_by: idSchema.nullable(),
  created_at: timestampSchema,
});

export const createOrderResponseSchema = z.object({
  message: z.string().min(1),
  order: orderSchema,
});

export const orderListResponseSchema = z.object({
  orders: z.array(orderSchema.extend({ item_count: decimalStringSchema })),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
});

export const orderDetailResponseSchema = z.object({
  order: orderSchema.extend({
    items: z.array(orderItemSchema).min(1),
    history: z.array(orderHistoryEntrySchema),
  }),
});

// PUT /api/orders/admin/:id/status
export const orderStatusUpdateResponseSchema = z.object({
  order: orderSchema,
});

export const invoiceResponseSchema = z.object({
  invoice: z.object({
    order: orderSchema.extend({
      email: z.email(),
      first_name: z.string(),
      last_name: z.string(),
    }),
    items: z.array(orderItemSchema).min(1),
  }),
});

// 402 from POST /api/orders when the simulated payment is declined
export const paymentFailedResponseSchema = errorResponseSchema.extend({
  code: z.literal("PAYMENT_FAILED"),
  paymentError: z.string().min(1),
});

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type Order = z.infer<typeof orderSchema>;
export type OrderDetail = z.infer<typeof orderDetailResponseSchema>["order"];
