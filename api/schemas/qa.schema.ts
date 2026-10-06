import { z } from "zod";
import { idSchema } from "./common.schema";

// PATCH /api/qa/products/:id/stock
export const setStockResponseSchema = z.object({
  product: z.object({
    id: idSchema,
    name: z.string().min(1),
    stock: z.number().int().nonnegative(),
  }),
  message: z.string().min(1),
});

// GET /api/qa/users/:email/verification-token
export const verificationTokenResponseSchema = z.object({
  email: z.email(),
  verificationToken: z.string().min(1),
  verificationUrl: z.url(),
});
