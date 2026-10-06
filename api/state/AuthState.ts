import { LoginResponse, LoginUser } from "../models/auth.models";

export class AuthState {
  private accessToken?: string;
  private refreshToken?: string;
  private user?: LoginUser;

  setAuth(response: LoginResponse): void {
    this.accessToken = response.accessToken;
    this.refreshToken = response.refreshToken;
    this.user = response.user;
  }

  getAccessToken(): string {
    if (!this.accessToken) {
      throw new Error("Access token is not available. User is not logged in.");
    }
    return this.accessToken;
  }

  getRefreshToken(): string {
    if (!this.refreshToken) {
      throw new Error("Refresh token is not available.");
    }
    return this.refreshToken;
  }

  getUserDetails(): LoginUser {
    if (!this.user) {
      throw new Error("User is not authenticated.");
    }
    return this.user;
  }

  clear(): void {
    this.accessToken = undefined;
    this.refreshToken = undefined;
    this.user = undefined;
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }
}
