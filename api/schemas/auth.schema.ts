import { z } from "zod";

export const registeredUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
});

export const registerUserResponseSchema = z.object({
  message: z.string(),
  user: registeredUserSchema,
  verificationToken: z.string(),
  verificationUrl: z.string().url(),
});

export const userProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
});

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  user: userProfileSchema,
});

export type RegisterUserResponseSchema = z.infer<typeof registerUserResponseSchema>;

export type LoginResponseSchema = z.infer<typeof loginResponseSchema>;

// POST /api/auth/refresh: a fresh token pair (the refresh token rotates)
export const tokenPairResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

// POST /api/auth/forgot-password. Outside production the API also returns the
// reset token, since no email is sent; the message never reveals whether the
// email exists.
export const forgotPasswordResponseSchema = z.object({
  message: z.literal("If this email exists, a reset link has been sent."),
  resetToken: z.string().min(1).optional(),
  resetUrl: z.string().optional(),
});
