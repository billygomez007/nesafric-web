import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";

/**
 * Onboarding checklist (item 6): org setup -> plan/trial -> property -> AI readiness -> dashboard,
 * with integrations always optional. Every step is derived directly from real organisation state
 * (never a separately tracked "wizard progress" flag that could drift from reality), so the
 * checklist is always consistent with what the organisation has actually done.
 */
export async function getOnboardingChecklist(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.propertyRead);
  const [subscription, propertyCount, aiEmployeeCount, enabledIntegrationCount] = await Promise.all([
    db.organisationSubscription.findUnique({ where: { organisationId } }),
    db.property.count({ where: { organisationId, archivedAt: null } }),
    db.aIEmployee.count({ where: { organisationId, archivedAt: null } }),
    db.integrationConfig.count({ where: { organisationId, enabled: true } }),
  ]);
  const steps = [
    { key: "organisation_setup", label: "Set up your organisation", done: true },
    {
      key: "plan_trial",
      label: subscription?.status === "TRIALING"
        ? `Free trial active — ends ${subscription.trialEndsAt?.toISOString().slice(0, 10) ?? "soon"}`
        : subscription
          ? `Subscription ${subscription.status.toLowerCase().replaceAll("_", " ")}`
          : "Start a plan",
      done: Boolean(subscription),
    },
    { key: "first_property", label: "Add your first property", done: propertyCount > 0 },
    { key: "ai_readiness", label: "Configure an AI employee", done: aiEmployeeCount > 0 },
  ];
  const optionalSteps = [
    { key: "integrations", label: "Connect optional integrations (e-signature, calendar, geocoding, communication channels)", done: enabledIntegrationCount > 0 },
  ];
  return { steps, optionalSteps, complete: steps.every((step) => step.done) };
}
