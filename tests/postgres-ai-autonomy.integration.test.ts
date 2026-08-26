import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  evaluateProactiveOperations,
  enqueueProactiveEvaluation,
  getAutonomyState,
  listAIActivities,
  setAutomationPaused,
  updateAutonomyConfiguration,
  upsertAutonomyPolicy,
} from "@/modules/ai-autonomy/service";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { db } from "@/platform/database/client";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

async function addMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
}

describe("PostgreSQL Phase 15 AI autonomy", () => {
  beforeEach(async () => {
    delete process.env.AI_AUTOMATION_PLATFORM_PAUSED;
    delete process.env.AI_PROVIDER_API_KEY;
    await cleanDatabase();
  });
  afterEach(async () => {
    const role = await db.role.findUnique({ where: { key: "property_manager" } });
    const permission = await db.permission.findUnique({ where: { key: "job.retry" } });
    if (role && permission) {
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  async function fixture() {
    const owner = await registerUser({ displayName: "Autonomy Owner", email: "autonomy-owner@example.com", password: "secure-password-123" });
    const manager = await registerUser({ displayName: "Autonomy Manager", email: "autonomy-manager@example.com", password: "secure-password-123" });
    const viewer = await registerUser({ displayName: "Autonomy Viewer", email: "autonomy-viewer@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Other Owner", email: "autonomy-other@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Autonomy Operations", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(outsider.id, { name: "Other Operations", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await addMember(organisation.id, manager.id, "property_manager");
    await addMember(organisation.id, viewer.id, "viewer");
    return { owner, manager, viewer, outsider, organisation, otherOrganisation };
  }

  async function failedJob(organisationId: string, suffix: string) {
    return db.backgroundJob.create({
      data: {
        organisationId,
        type: "test.retryable",
        idempotencyKey: `autonomy-${suffix}`,
        payload: {},
        status: "FAILED",
        attempts: 1,
        maxAttempts: 3,
        lastError: "Temporary provider failure",
      },
    });
  }

  it("creates organisation-scoped configuration and policies with RBAC and platform precedence", async () => {
    const { owner, manager, viewer, outsider, organisation, otherOrganisation } = await fixture();
    const configuration = await updateAutonomyConfiguration(owner.id, organisation.id, {
      enabled: true,
      defaultLevel: "RECOMMEND_ONLY",
      communicationAllowed: true,
    });
    expect(configuration.automationActorUserId).toBe(owner.id);
    const policy = await upsertAutonomyPolicy(owner.id, organisation.id, {
      actionKey: "background_job.retry",
      enabled: true,
      level: "AUTO_EXECUTE",
      timezone: "UTC",
      maxExecutions: 2,
      frequencyWindowMinutes: 60,
    });
    expect(policy.level).toBe("AUTO_EXECUTE");
    await expect(upsertAutonomyPolicy(owner.id, organisation.id, {
      actionKey: "payment.reverse",
      enabled: true,
      level: "AUTO_EXECUTE",
      timezone: "UTC",
    })).rejects.toMatchObject({ code: "PLATFORM_AUTONOMY_PROHIBITED" });
    await expect(upsertAutonomyPolicy(owner.id, organisation.id, {
      actionKey: "maintenance.create",
      enabled: true,
      level: "AUTO_EXECUTE",
      timezone: "UTC",
    })).rejects.toMatchObject({ code: "AI_ACTION_NOT_AUTO_EXECUTE_ELIGIBLE" });
    await expect(updateAutonomyConfiguration(manager.id, organisation.id, {
      enabled: true,
      defaultLevel: "RECOMMEND_ONLY",
      communicationAllowed: true,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getAutonomyState(viewer.id, organisation.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getAutonomyState(outsider.id, organisation.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getAutonomyState(outsider.id, otherOrganisation.id)).policies).toHaveLength(0);
  });

  it("enforces disabled, recommend-only, approval-required, kill-switch, window, and provider-outage behavior", async () => {
    const { owner, organisation } = await fixture();
    await updateAutonomyConfiguration(owner.id, organisation.id, {
      enabled: true,
      defaultLevel: "DISABLED",
      communicationAllowed: true,
    });
    const first = await failedJob(organisation.id, "disabled");
    await evaluateProactiveOperations(organisation.id, new Date("2026-08-27T12:00:00Z"));
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("FAILED");
    expect(await db.aIActivity.findFirst({ where: { organisationId: organisation.id, policyDecision: "DISABLED" } })).toBeTruthy();

    await upsertAutonomyPolicy(owner.id, organisation.id, { actionKey: "background_job.retry", enabled: true, level: "RECOMMEND_ONLY", timezone: "UTC" });
    const second = await failedJob(organisation.id, "recommend");
    await evaluateProactiveOperations(organisation.id, new Date("2026-08-28T12:00:00Z"));
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("FAILED");
    expect(await db.aIActivity.findFirst({ where: { organisationId: organisation.id, type: "RECOMMENDATION", actionKey: "background_job.retry" } })).toBeTruthy();

    await upsertAutonomyPolicy(owner.id, organisation.id, { actionKey: "background_job.retry", enabled: true, level: "APPROVAL_REQUIRED", timezone: "UTC" });
    const third = await failedJob(organisation.id, "approval");
    await evaluateProactiveOperations(organisation.id, new Date("2026-08-29T12:00:00Z"));
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: third.id } })).status).toBe("FAILED");
    expect(await db.aIActivity.findFirst({ where: { organisationId: organisation.id, type: "PROPOSAL", proposalId: { not: null } } })).toBeTruthy();

    await upsertAutonomyPolicy(owner.id, organisation.id, { actionKey: "background_job.retry", enabled: true, level: "AUTO_EXECUTE", timezone: "UTC", executionWindowStartMinute: 60, executionWindowEndMinute: 120 });
    const fourth = await failedJob(organisation.id, "window");
    await evaluateProactiveOperations(organisation.id, new Date("2026-08-30T12:00:00Z"));
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: fourth.id } })).status).toBe("FAILED");
    expect(await db.aIActivity.findFirst({ where: { organisationId: organisation.id, policyDecision: "BLOCKED_EXECUTION_WINDOW" } })).toBeTruthy();

    await setAutomationPaused(owner.id, organisation.id, { paused: true, reason: "Emergency operational pause." });
    expect((await getAutonomyState(owner.id, organisation.id)).configuration?.automationPaused).toBe(true);
    await setAutomationPaused(owner.id, organisation.id, { paused: false, reason: "Operations reviewed and safe." });
    process.env.AI_AUTOMATION_PLATFORM_PAUSED = "true";
    process.env.AI_PROVIDER_API_KEY = "unavailable-provider-does-not-affect-detection";
    const fifth = await failedJob(organisation.id, "platform-pause");
    await evaluateProactiveOperations(organisation.id, new Date("2026-08-31T01:30:00Z"));
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: fifth.id } })).status).toBe("FAILED");
    expect(await db.aIActivity.findFirst({ where: { organisationId: organisation.id, policyDecision: "BLOCKED_PLATFORM_KILL_SWITCH" } })).toBeTruthy();
  });

  it("auto-executes eligible actions once, applies frequency limits, and records audit history", async () => {
    const { owner, organisation } = await fixture();
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    await upsertAutonomyPolicy(owner.id, organisation.id, {
      actionKey: "background_job.retry",
      enabled: true,
      level: "AUTO_EXECUTE",
      timezone: "UTC",
      maxExecutions: 1,
      frequencyWindowMinutes: 60,
    });
    const first = await failedJob(organisation.id, "auto-first");
    const second = await failedJob(organisation.id, "auto-second");
    const now = new Date();
    await evaluateProactiveOperations(organisation.id, now);
    const retryStates = await db.backgroundJob.findMany({ where: { id: { in: [first.id, second.id] } }, select: { lastError: true } });
    expect(retryStates.filter(({ lastError }) => lastError === null)).toHaveLength(1);
    expect(retryStates.filter(({ lastError }) => lastError !== null)).toHaveLength(1);
    expect(await db.aIActivity.count({ where: { organisationId: organisation.id, type: "AUTO_EXECUTION", status: "COMPLETED" } })).toBe(1);
    expect(await db.aIActivity.count({ where: { organisationId: organisation.id, policyDecision: "BLOCKED_FREQUENCY_LIMIT" } })).toBe(1);
    await evaluateProactiveOperations(organisation.id, now);
    expect(await db.aIActivity.count({ where: { organisationId: organisation.id, type: "AUTO_EXECUTION", status: "COMPLETED" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: "ai.autonomous_action.executed" } })).toBe(1);
    expect(await db.domainEvent.count({ where: { organisationId: organisation.id, name: "ai.autonomous_action.executed" } })).toBe(1);
    expect((await listAIActivities(owner.id, organisation.id)).some((activity) => activity.policyDecision === "BLOCKED_FREQUENCY_LIMIT")).toBe(true);
  });

  it("escalates failed domain enforcement once without increasing autonomy", async () => {
    const { owner, manager, organisation } = await fixture();
    await updateAutonomyConfiguration(owner.id, organisation.id, {
      enabled: true,
      defaultLevel: "RECOMMEND_ONLY",
      communicationAllowed: true,
      automationActorUserId: manager.id,
    });
    const managerRole = await db.role.findUniqueOrThrow({ where: { key: "property_manager" } });
    const retryPermission = await db.permission.findUniqueOrThrow({ where: { key: "job.retry" } });
    await db.rolePermission.delete({ where: { roleId_permissionId: { roleId: managerRole.id, permissionId: retryPermission.id } } });
    await upsertAutonomyPolicy(owner.id, organisation.id, { actionKey: "background_job.retry", enabled: true, level: "AUTO_EXECUTE", timezone: "UTC" });
    await failedJob(organisation.id, "domain-block");
    const now = new Date("2026-09-02T12:00:00Z");
    await evaluateProactiveOperations(organisation.id, now);
    const failure = await db.aIActivity.findFirstOrThrow({ where: { organisationId: organisation.id, type: "FAILURE" } });
    expect(failure.failureCode).toBe("FORBIDDEN");
    expect(await db.aIEscalation.count({ where: { activityId: failure.id } })).toBe(1);
    expect(await db.aIActivity.count({ where: { organisationId: organisation.id, type: "ESCALATION", parentActivityId: failure.id } })).toBe(1);
    await evaluateProactiveOperations(organisation.id, now);
    expect(await db.aIEscalation.count({ where: { activityId: failure.id } })).toBe(1);
  });

  it("runs proactive evaluation through the durable worker and schedules the next evaluation", async () => {
    const { owner, organisation } = await fixture();
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    const job = await enqueueProactiveEvaluation(owner.id, organisation.id);
    await runDueJobs(createJobHandlers());
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SUCCEEDED");
    expect(await db.backgroundJob.count({ where: { organisationId: organisation.id, type: "ai-proactive-evaluation", status: "PENDING" } })).toBe(1);
  });
});
