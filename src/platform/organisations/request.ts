import { AppError } from "@/platform/errors";

export function requireOrganisationId(request: Request) {
  const organisationId = request.headers.get("x-organisation-id");
  if (!organisationId) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
  return organisationId;
}
