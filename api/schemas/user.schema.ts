import { z } from "zod";
import { idSchema, timestampSchema } from "./common.schema";
import { productSchema } from "./product.schema";

// GET /api/users/me (snake_case, unlike the login response's user)
export const currentUserSchema = z.object({
  id: idSchema,
  email: z.email(),
  first_name: z.string(),
  last_name: z.string(),
  phone: z.string().nullable(),
  role: z.enum(["customer", "admin"]),
  status: z.string().min(1),
  avatar_url: z.string().nullable(),
  created_at: timestampSchema,
});

export const currentUserResponseSchema = z.object({
  user: currentUserSchema,
});

// PUT /api/users/me echoes back only the editable fields
export const updateProfileResponseSchema = z.object({
  user: currentUserSchema.pick({
    id: true,
    email: true,
    first_name: true,
    last_name: true,
    phone: true,
  }),
});

export const wishlistResponseSchema = z.object({
  wishlist: z.array(productSchema),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;
