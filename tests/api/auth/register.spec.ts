import { expect, test } from "@playwright/test";
import { faker } from "@faker-js/faker";
import { AuthApi } from "../../../api/clients/AuthApi";
import { RegisterUserRequest } from "../../../api/models/auth.models";
import { registerUserResponseSchema } from "../../../api/schemas/auth.schema";

let fakeEmail: string = faker.internet.email().toLowerCase();
let password: string = "Test@1998";
let country: string = "India";
let label: string = "Home";

test("User Registration test", async ({ request }) => {
  const authApi = new AuthApi(request);

  const payload: RegisterUserRequest = {
    email: fakeEmail,
    password: password,
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    phone: faker.string.numeric(10),
    address: {
      label: label,
      fullName: faker.person.fullName(),
      phone: faker.string.numeric(10),
      line1: faker.location.streetAddress(),
      line2: faker.location.secondaryAddress(),
      city: faker.location.city(),
      state: faker.location.state(),
      postalCode: faker.string.numeric(6),
      country: country,
    },
  };

  const response = await authApi.registerNewUser(payload);
  const validatedResponse = registerUserResponseSchema.parse(response);

  expect(validatedResponse.message).toBe(
    "Registration successful. Please verify your email.",
  );
  expect(validatedResponse.user.id).toBeDefined();
  expect(validatedResponse.user.email).toBe(payload.email);
  expect(validatedResponse.user.firstName).toBe(payload.firstName);
  expect(validatedResponse.user.lastName).toBe(payload.lastName);
  expect(validatedResponse.verificationToken).toBeDefined();
  expect(validatedResponse.verificationUrl).toContain(
    "/api/auth/verify-email/",
  );
});
