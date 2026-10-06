import { z } from "zod";
import { idSchema, timestampSchema } from "./common.schema";

export const savedAddressSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  label: z.string(),
  full_name: z.string().min(1),
  phone: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().nullable(),
  city: z.string().min(1),
  state: z.string().min(1),
  postal_code: z.string().regex(/^\d{6}$/, "Expected a 6-digit postal code"),
  country: z.string().min(1),
  is_default: z.boolean(),
  created_at: timestampSchema,
});

export const addressResponseSchema = z.object({
  address: savedAddressSchema,
});

export const addressesResponseSchema = z.object({
  addresses: z.array(savedAddressSchema),
});

export type SavedAddress = z.infer<typeof savedAddressSchema>;
