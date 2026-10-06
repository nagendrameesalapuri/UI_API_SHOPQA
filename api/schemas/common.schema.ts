import { z } from "zod";

// Postgres NUMERIC columns arrive as strings, e.g. "799.00" or "12"
export const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "Expected a numeric string");

export const timestampSchema = z.iso.datetime({ offset: true });

export const idSchema = z.uuid();

// { "message": "..." } returned by most write endpoints
export const messageResponseSchema = z.object({
  message: z.string().min(1),
});

// Every 4xx/5xx body: { error, code } plus a few endpoint-specific extras
export const errorResponseSchema = z.object({
  error: z.string().min(1),
  code: z.string().min(1),
  paymentError: z.string().optional(),
  available: z.number().optional(),
  attemptsRemaining: z.number().int().nonnegative().optional(),
  lockedUntil: timestampSchema.optional(),
  details: z
    .array(z.object({ field: z.string().min(1), message: z.string().min(1) }))
    .optional(),
});

// 400 VALIDATION_ERROR from express-validator, naming each rejected field
export const validationErrorResponseSchema = errorResponseSchema.extend({
  code: z.literal("VALIDATION_ERROR"),
  details: z
    .array(z.object({ field: z.string().min(1), message: z.string().min(1) }))
    .min(1),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
