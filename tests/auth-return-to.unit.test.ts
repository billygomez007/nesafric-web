import {
  describe,
  expect,
  it,
} from "vitest";

import {
  AUTH_RETURN_TO_COOKIE,
  AUTH_RETURN_TO_MAX_AGE_SECONDS,
  safeReturnTo,
} from "@/platform/auth/return-to";

describe("safeReturnTo", () => {
  it("accepts an invitation fragment path", () => {
    expect(
      safeReturnTo(
        "/invitations/accept#token=opaque-token",
      ),
    ).toBe(
      "/invitations/accept#token=opaque-token",
    );
  });

  it("accepts an internal dashboard path", () => {
    expect(
      safeReturnTo("/dashboard"),
    ).toBe("/dashboard");
  });

  it("rejects an absolute URL", () => {
    expect(
      safeReturnTo(
        "https://evil.example",
      ),
    ).toBeNull();
  });

  it("rejects a protocol-relative URL", () => {
    expect(
      safeReturnTo(
        "//evil.example",
      ),
    ).toBeNull();
  });

  it("rejects backslash ambiguity", () => {
    expect(
      safeReturnTo(
        "/\\evil.example",
      ),
    ).toBeNull();
  });

  it("rejects newline injection", () => {
    expect(
      safeReturnTo(
        "/dashboard\nLocation: https://evil.example",
      ),
    ).toBeNull();
  });

  it("has the expected short-lived cookie contract", () => {
    expect(
      AUTH_RETURN_TO_COOKIE,
    ).toBe(
      "nesafric_auth_return_to",
    );

    expect(
      AUTH_RETURN_TO_MAX_AGE_SECONDS,
    ).toBe(600);
  });
});
