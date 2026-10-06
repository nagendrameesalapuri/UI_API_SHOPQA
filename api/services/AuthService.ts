import { AuthApi } from "../clients/AuthApi";
import { LoginRequest } from "../models/auth.models";
import { loginResponseSchema } from "../schemas/auth.schema";
import { AuthState } from "../state/AuthState";

export class AuthService {
  private readonly authApi: AuthApi;
  private readonly authState: AuthState;

  constructor(authApi: AuthApi, authState: AuthState) {
    this.authApi = authApi;
    this.authState = authState;
  }

  async login(credentials: LoginRequest): Promise<void> {
    const response = await this.authApi.login(credentials);
    const validatedResponse = loginResponseSchema.parse(response);
    this.authState.setAuth(validatedResponse);
  }
}
