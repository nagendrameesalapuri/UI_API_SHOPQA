import { faker } from "@faker-js/faker";
import { Address, RegisterUserRequest } from "../api/models/auth.models";

export const DEFAULT_PASSWORD = "Password123!";
export const EXISTING_USER_EMAIL = "john@test.com";

export function buildNewUser(): RegisterUserRequest {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();

  return {
    email:
      `pw.${faker.string.alphanumeric(8)}.${Date.now()}@test.com`.toLowerCase(),
    password: DEFAULT_PASSWORD,
    firstName,
    lastName,
    phone: faker.string.numeric(10),
  };
}

export function buildAddress(overrides: Partial<Address> = {}): Address {
  return {
    label: "Home",
    fullName: faker.person.fullName(),
    phone: faker.string.numeric(10),
    line1: faker.location.streetAddress(),
    line2: faker.location.secondaryAddress(),
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    country: "India",
    ...overrides,
  };
}
