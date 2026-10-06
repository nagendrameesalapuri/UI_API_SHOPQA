import { APIRequestContext } from "@playwright/test";
import {
  LoginRequest,
  LoginResponse,
  RegisterUserRequest,
} from "../models/auth.models";
import {
  forgotPasswordResponseSchema,
  tokenPairResponseSchema,
} from "../schemas/auth.schema";
import { messageResponseSchema } from "../schemas/common.schema";

export class AuthApi {
  private readonly baseUrl: string;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.baseUrl = process.env.API_BASE_URL!;
    this.request = request;
  }

  async registerNewUser(payload: RegisterUserRequest) {
    const response = await this.request.post(
      `${this.baseUrl}/api/auth/register`,
      {
        data: payload,
      },
    );

    if (!response.ok()) {
      throw new Error(`Register user failed. Status: ${response.status()}`);
    }

    return await response.json();
  }

  async verifyEmail(token: string) {
    const response = await this.request.get(
      `${this.baseUrl}/api/auth/verify-email/${token}`,
    );

    if (!response.ok()) {
      throw new Error(`Verify email failed. Status: ${response.status()}`);
    }

    return await response.json();
  }

  async login(payload: LoginRequest): Promise<LoginResponse> {
    const response = await this.request.post(`${this.baseUrl}/api/auth/login`, {
      data: payload,
    });

    if (!response.ok()) {
      throw new Error(`Login failed. Status: ${response.status()}`);
    }

    return await response.json();
  }

  async refreshToken(refreshToken: string) {
    const response = await this.request.post(`${this.baseUrl}/api/auth/refresh`, {
      data: { refreshToken },
    });

    if (!response.ok()) {
      throw new Error(`Refresh token failed. Status: ${response.status()}`);
    }

    return tokenPairResponseSchema.parse(await response.json());
  }

  async logout(accessToken: string, refreshToken: string) {
    const response = await this.request.post(`${this.baseUrl}/api/auth/logout`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { refreshToken },
    });

    if (!response.ok()) {
      throw new Error(`Logout failed. Status: ${response.status()}`);
    }

    return messageResponseSchema.parse(await response.json());
  }

  async forgotPassword(email: string) {
    const response = await this.request.post(
      `${this.baseUrl}/api/auth/forgot-password`,
      { data: { email } },
    );

    if (!response.ok()) {
      throw new Error(`Forgot password failed. Status: ${response.status()}`);
    }

    return forgotPasswordResponseSchema.parse(await response.json());
  }

  async resetPassword(token: string, password: string) {
    const response = await this.request.post(
      `${this.baseUrl}/api/auth/reset-password`,
      { data: { token, password } },
    );

    if (!response.ok()) {
      throw new Error(`Reset password failed. Status: ${response.status()}`);
    }

    return messageResponseSchema.parse(await response.json());
  }
}
