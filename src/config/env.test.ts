import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  UI_BASE_URL: "https://ui.example.test",
  API_BASE_URL: "https://api.example.test",
  UI_TEST_ADMIN_EMAIL: "admin@example.test",
  UI_TEST_ADMIN_PASSWORD: "x",
  UI_TEST_CUSTOMER_EMAIL: "customer@example.test",
  UI_TEST_CUSTOMER_PASSWORD: "x",
  API_TEST_EMAIL: "api@example.test",
  API_TEST_PASSWORD: "x",
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.TEST_ENV).toBe("qa");
    expect(env.TARGET).toBe("real");
    expect(env.LLM_PROVIDER).toBe("none");
    expect(env.ADO_PAT).toBeUndefined();
  });

  it("treats empty optional values as unset", () => {
    expect(parseEnv({ ...valid, ADO_ORG: "" }).ADO_ORG).toBeUndefined();
  });

  it("lists every missing or invalid variable in one error", () => {
    const { UI_BASE_URL: _ui, API_TEST_PASSWORD: _pw, ...rest } = valid;
    expect(() => parseEnv({ ...rest, LLM_PROVIDER: "gpt" })).toThrowError(
      /UI_BASE_URL[\s\S]*API_TEST_PASSWORD[\s\S]*LLM_PROVIDER/,
    );
  });
});
