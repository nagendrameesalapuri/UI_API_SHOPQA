import { APIRequestContext } from "@playwright/test";
import { CurrentUser, currentUserResponseSchema } from "../schemas/user.schema";

export class UserApi {
  private readonly baseUrl: string;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.baseUrl = process.env.API_BASE_URL!;
    this.request = request;
  }

  async getProfile(accessToken: string): Promise<CurrentUser> {
    const response = await this.request.get(`${this.baseUrl}/api/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok()) {
      throw new Error(`Get profile failed. Status: ${response.status()}`);
    }

    return currentUserResponseSchema.parse(await response.json()).user;
  }
}
