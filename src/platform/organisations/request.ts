import { AppError } from "@/platform/errors";
import { isUuid } from "@/platform/validation/uuid";

/**
 * Normalizes the x-organisation-id header. Client code sometimes sends the literal
 * string "null"/"undefined" (from `String(null)`/template-literal coercion of an
 * unselected organisation) or a malformed value — both are truthy strings that would
 * otherwise reach Postgres as an invalid UUID and surface as a raw, sanitized 500.
 * Collapses all of those cases to a real `null` instead.
 */
export function getOrganisationIdHeader(request: Request): string | null {
  const value = request.headers.get("x-organisation-id");
  if (!value || value === "null" || value === "undefined" || !isUuid(value)) return null;
  return value;
}

export function requireOrganisationId(request: Request) {
  const organisationId = getOrganisationIdHeader(request);
  if (!organisationId) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
  return organisationId;
}
