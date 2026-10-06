export interface Address {
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}
export interface RegisterUserRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  address?: Address;
}

export interface RegisteredUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface RegisterUserResponse {
  message: string;
  user: RegisteredUser;
  verificationToken: string;
  verificationUrl: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: LoginUser;
}
