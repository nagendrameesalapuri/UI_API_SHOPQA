import path from "node:path";
import { env } from "../config/env";

// Roles with a fixed account. storageState for each is saved by tests/setup/auth.setup.ts.
export const ROLES = ["admin", "customer"] as const;
export type Role = (typeof ROLES)[number];

export const AUTH_DIR = path.resolve(__dirname, "..", "..", ".auth");

export function storageStatePath(role: Role): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

export function credentialsFor(role: Role): { email: string; password: string } {
  const c = env();
  switch (role) {
    case "admin":
      return { email: c.UI_TEST_ADMIN_EMAIL, password: c.UI_TEST_ADMIN_PASSWORD };
    case "customer":
      return { email: c.UI_TEST_CUSTOMER_EMAIL, password: c.UI_TEST_CUSTOMER_PASSWORD };
  }
}
