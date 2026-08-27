import { describe, expect, it } from "vitest";
import { AppError } from "@/platform/errors";
import { getOrganisationIdHeader, requireOrganisationId } from "@/platform/organisations/request";
import { isUuid } from "@/platform/validation/uuid";
import { requirePermission } from "@/platform/authorization/permissions";
import { requireMarketplaceRole } from "@/modules/marketplace-professionals/permissions";

const VALID_UUID = "123e4567-e89b-42d3-a456-426614174000";

function requestWith(headerValue: string | null) {
  const headers = new Headers();
  if (headerValue !== null) headers.set("x-organisation-id", headerValue);
  return new Request("https://example.test/api/dashboard", { headers });
}

describe("isUuid", () => {
  it("accepts a well-formed UUID", () => {
    expect(isUuid(VALID_UUID)).toBe(true);
  });

  it("rejects the literal strings a coerced null/undefined produces", () => {
    expect(isUuid("null")).toBe(false);
    expect(isUuid("undefined")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});

describe("getOrganisationIdHeader", () => {
  it("returns null when the header is absent", () => {
    expect(getOrganisationIdHeader(requestWith(null))).toBeNull();
  });

  it("collapses the literal string \"null\" (from client-side String(null) coercion) to null instead of a bad UUID", () => {
    expect(getOrganisationIdHeader(requestWith("null"))).toBeNull();
  });

  it("collapses the literal string \"undefined\" to null", () => {
    expect(getOrganisationIdHeader(requestWith("undefined"))).toBeNull();
  });

  it("collapses a malformed, non-UUID value to null rather than passing it through", () => {
    expect(getOrganisationIdHeader(requestWith("../etc/passwd"))).toBeNull();
  });

  it("passes through a well-formed UUID unchanged", () => {
    expect(getOrganisationIdHeader(requestWith(VALID_UUID))).toBe(VALID_UUID);
  });
});

describe("requireOrganisationId", () => {
  it("throws a clean 400 AppError for a missing header instead of ever reaching the database", () => {
    expect(() => requireOrganisationId(requestWith(null))).toThrow(AppError);
    try {
      requireOrganisationId(requestWith(null));
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(400);
    }
  });

  it("throws the same clean 400 for the literal string \"null\" (previously reached Postgres as an invalid UUID and surfaced as a raw 500)", () => {
    expect(() => requireOrganisationId(requestWith("null"))).toThrow(AppError);
    try {
      requireOrganisationId(requestWith("null"));
    } catch (error) {
      expect((error as AppError).status).toBe(400);
    }
  });

  it("returns a well-formed UUID unchanged", () => {
    expect(requireOrganisationId(requestWith(VALID_UUID))).toBe(VALID_UUID);
  });
});

describe("requirePermission rejects malformed organisation IDs before querying the database", () => {
  it("throws FORBIDDEN (403), not a raw database error, for the literal string \"null\"", async () => {
    await expect(requirePermission("any-user-id", "null", "property.read")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("throws FORBIDDEN (403) for any other non-UUID organisation ID", async () => {
    await expect(requirePermission("any-user-id", "../etc/passwd", "property.read")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

describe("requireMarketplaceRole rejects malformed marketplace professional IDs before querying the database", () => {
  it("throws FORBIDDEN (403), not a raw database error, for the literal string \"null\"", async () => {
    await expect(requireMarketplaceRole("any-user-id", "null", "AGENT")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});
