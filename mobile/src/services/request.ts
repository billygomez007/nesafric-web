import { ApiError, NETWORK_ERROR } from "@/api/client";

export const MAX_REQUEST_MESSAGE = 10_000;
export const MIN_REQUEST_MESSAGE = 10;

/** Maintenance states the server refuses to quote against (`requestMarketplaceQuote`). */
export const TERMINAL_MAINTENANCE = ["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"];

export type ServiceRequestForm = {
  organisationId: string | null;
  categoryId: string | null;
  propertyId: string | null;
  maintenanceRequestId: string | null;
  message: string;
  requestQuote: boolean;
};

export type ServiceRequestErrors = Partial<Record<"organisationId" | "categoryId" | "message" | "requestQuote", string>>;

export function validateServiceRequest(form: ServiceRequestForm): ServiceRequestErrors {
  const errors: ServiceRequestErrors = {};
  const message = form.message.trim();
  if (!form.organisationId) errors.organisationId = "Choose the workspace this request is for.";
  if (!form.categoryId) errors.categoryId = "Choose the service you need.";
  if (message.length < MIN_REQUEST_MESSAGE) errors.message = "Describe the job in a sentence or two.";
  else if (message.length > MAX_REQUEST_MESSAGE) errors.message = "Keep the description under 10,000 characters.";
  if (form.requestQuote && !form.maintenanceRequestId) errors.requestQuote = "A formal quotation needs a maintenance request.";
  return errors;
}

/** Plain-language reasons for the server's refusals; the server remains the only judge. */
export function serviceRequestErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === NETWORK_ERROR) return error.message;
    if (error.status === 401) return "Your session has ended. Sign in again to send this request.";
    if (error.status === 403) return "Your role in this workspace can't send marketplace requests. Ask a workspace administrator for access.";
    if (error.code === "MARKETPLACE_PROVIDER_UNAVAILABLE") return "This provider no longer offers that service on the marketplace. Choose another service or provider.";
    if (error.code === "PROVIDER_NOT_READY") return "This provider can't take quotation requests right now.";
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
