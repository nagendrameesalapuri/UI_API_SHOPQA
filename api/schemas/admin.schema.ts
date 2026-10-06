import { z } from "zod";
import { decimalStringSchema, idSchema, timestampSchema } from "./common.schema";
import { orderStatusSchema } from "./order.schema";

export const dashboardResponseSchema = z.object({
  stats: z.object({
    total_users: decimalStringSchema,
    new_users_week: decimalStringSchema,
    total_products: decimalStringSchema,
    out_of_stock: decimalStringSchema,
    total_orders: decimalStringSchema,
    pending_orders: decimalStringSchema,
    total_revenue: decimalStringSchema,
    revenue_month: decimalStringSchema,
  }),
  recentOrders: z.array(
    z.object({
      order_number: z.string().min(1),
      total: decimalStringSchema,
      status: orderStatusSchema,
      created_at: timestampSchema,
      email: z.email(),
    }),
  ),
  salesChart: z.array(
    z.object({
      date: timestampSchema,
      revenue: decimalStringSchema,
      orders: decimalStringSchema,
    }),
  ),
});

export const userStatusSchema = z.enum([
  "active",
  "locked",
  "banned",
  "pending_verification",
]);

export const adminUserSchema = z.object({
  id: idSchema,
  email: z.email(),
  first_name: z.string(),
  last_name: z.string(),
  role: z.enum(["customer", "admin"]),
  status: userStatusSchema,
  created_at: timestampSchema,
  last_login: timestampSchema.nullable(),
  login_attempts: z.number().int().nonnegative(),
});

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema),
  total: z.number().int().nonnegative(),
});

// PATCH /api/admin/users/:id
export const adminUserUpdateResponseSchema = z.object({
  user: z.object({
    id: idSchema,
    email: z.email(),
    status: userStatusSchema,
    role: z.enum(["customer", "admin"]),
  }),
});

export type AdminUser = z.infer<typeof adminUserSchema>;
