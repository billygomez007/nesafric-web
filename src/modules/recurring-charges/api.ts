import { requireUser } from "@/platform/auth/session";
import {
  PERMISSIONS,
  requirePermission,
} from "@/platform/authorization/permissions";
import { requireOrganisationId } from "@/platform/organisations/request";

export type RecurringChargeApiContext = {
  userId: string;
  organisationId: string;
};

/**
 * Read access to recurring charges follows the existing lease permission
 * boundary because recurring charges are financial obligations belonging
 * to a lease/property relationship.
 *
 * Authentication alone is never sufficient: the user must be an active
 * member of the selected organisation and hold lease.read.
 */
export async function requireRecurringChargeReadContext(
  request: Request,
): Promise<RecurringChargeApiContext> {
  const user = await requireUser();
  const organisationId = requireOrganisationId(request);

  await requirePermission(user.id, organisationId, PERMISSIONS.leaseRead);

  return {
    userId: user.id,
    organisationId,
  };
}

/**
 * Creating, editing, archiving, generating, finalising or waiving a charge
 * mutates lease-related financial obligations and therefore requires the
 * existing lease.update organisation permission.
 */
export async function requireRecurringChargeWriteContext(
  request: Request,
): Promise<RecurringChargeApiContext> {
  const user = await requireUser();
  const organisationId = requireOrganisationId(request);

  await requirePermission(user.id, organisationId, PERMISSIONS.leaseUpdate);

  return {
    userId: user.id,
    organisationId,
  };
}
