import { describe, expect, it } from "vitest";
import { maskSecrets } from "./logger";
import { isSorted } from "./matchers";

describe("maskSecrets", () => {
  it("masks secret keys at any depth and keeps other values", () => {
    const masked = maskSecrets({
      email: "a@b.c",
      password: "p",
      nested: { headers: { Authorization: "Bearer abc" }, list: [{ token: "t" }] },
    });
    expect(masked).toEqual({
      email: "a@b.c",
      password: "***",
      nested: { headers: { Authorization: "***" }, list: [{ token: "***" }] },
    });
  });

  it("masks bearer tokens and JWTs inside strings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlMTIz";
    expect(maskSecrets(`Authorization: Bearer xyz.123 and ${jwt}`)).toBe(
      "Authorization: Bearer *** and ***",
    );
  });
});

describe("isSorted", () => {
  it.each([
    [[1, 2, 2, 3], "asc", true],
    [[3, 2, 1], "desc", true],
    [[1, 3, 2], "asc", false],
    [[], "asc", true],
  ] as const)("%j %s -> %s", (values, dir, expected) => {
    expect(isSorted(values, dir)).toBe(expected);
  });
});
