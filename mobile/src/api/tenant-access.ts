import type { ApiClient } from "./client";

export type TenantAccessValidation =
  | {
      valid: false;
    }
  | {
      valid: true;
      expiresAt: string;
    };

export type TenantAccessRedemption = {
  tenantOrganisationId: string;
  alreadyRedeemed: boolean;
};

export function validateTenantAccessCode(
  api: ApiClient,
  code: string,
  signal?: AbortSignal,
) {
  return api.request<TenantAccessValidation>(
    "/api/account/tenant-access/validate",
    {
      method: "POST",
      auth: true,
      body: { code },
      signal,
    },
  );
}

export function redeemTenantAccessCode(
  api: ApiClient,
  code: string,
  signal?: AbortSignal,
) {
  return api.request<TenantAccessRedemption>(
    "/api/account/tenant-access/redeem",
    {
      method: "POST",
      auth: true,
      body: { code },
      signal,
    },
  );
}
