import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPortfolio, createProperty } from "@/modules/assets/service";
import {
  createAIEmployee,
  createAIEmployeeHandoff,
  detectAIEmployeeAssignmentConflicts,
  executeEmployeeAction,
  getAIEmployeeWorkspace,
  listAIEmployees,
  receptionistMaintenanceIntake,
  updateAIEmployee,
  updateAIEmployeeHandoff,
} from "@/modules/ai-employees/service";
import { updateAutonomyConfiguration, upsertAutonomyPolicy } from "@/modules/ai-autonomy/service";
import { decideAIProposal } from "@/modules/ai/service";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { changeOrganisationPlan } from "@/modules/subscriptions/service";
import { db } from "@/platform/database/client";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
}

async function addMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return member;
}

describe("PostgreSQL Phase 16 AI employees", () => {
  beforeEach(async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.AI_PROVIDER_API_KEY;
    await cleanDatabase();
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  async function fixture() {
    const owner = await registerUser({ displayName: "AI Employer", email: "ai-employer@example.com", password: "secure-password-123" });
    const manager = await registerUser({ displayName: "Human Manager", email: "employee-manager@example.com", password: "secure-password-123" });
    const administrator = await registerUser({ displayName: "AI Administrator", email: "employee-admin@example.com", password: "secure-password-123" });
    const viewer = await registerUser({ displayName: "Employee Viewer", email: "employee-viewer@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Other Employer", email: "other-employer@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "AI Employee Operations", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrganisation = await createOrganisation(outsider.id, { name: "Other AI Employees", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    // These fixtures create more AI employees than the default STARTER plan's entitlement limit
    // (1) allows; upgrade to a plan with enough headroom so this file continues to exercise
    // multi-employee scenarios rather than the (separately tested) entitlement limit itself.
    await changeOrganisationPlan(owner.id, organisation.id, { planKey: "growth" });
    const managerMember = await addMember(organisation.id, manager.id, "property_manager");
    await addMember(organisation.id, administrator.id, "administrator");
    await addMember(organisation.id, viewer.id, "viewer");
    const eastPortfolio = await createPortfolio(owner.id, organisation.id, { name: "East Portfolio" });
    const westPortfolio = await createPortfolio(owner.id, organisation.id, { name: "West Portfolio" });
    const east = await createProperty(owner.id, organisation.id, { name: "East Apartments", referenceNumber: "EAST-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", portfolioId: eastPortfolio.id, units: [{ name: "A1" }] });
    const west = await createProperty(owner.id, organisation.id, { name: "West Apartments", referenceNumber: "WEST-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", portfolioId: westPortfolio.id, units: [{ name: "B1" }] });
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    return { owner, manager, administrator, viewer, outsider, organisation, otherOrganisation, managerMember, eastPortfolio, westPortfolio, east, west };
  }

  const employeeInput = (overrides: Record<string, unknown> = {}) => ({
    name: "Ama",
    role: "RECEPTIONIST",
    description: "Handles low-risk tenant and prospect enquiries.",
    status: "ACTIVE",
    scope: "ORGANISATION",
    portfolioIds: [],
    propertyIds: [],
    responsibilities: ["Maintenance intake", "Human routing"],
    instructions: { greeting: "Akwaaba", tone: "professional" },
    escalationConfiguration: { routeUncertainRequests: true },
    timezone: "Africa/Accra",
    toolPermissions: ["maintenance.create", "listings.summary"],
    autonomyPolicyIds: [],
    ...overrides,
  });

  it("creates multiple role-specific employees with organisation, portfolio, and property assignments", async () => {
    const { owner, viewer, organisation, eastPortfolio, west } = await fixture();
    const receptionist = await createAIEmployee(owner.id, organisation.id, employeeInput());
    const manager = await createAIEmployee(owner.id, organisation.id, employeeInput({
      name: "Kofi",
      role: "PROPERTY_MANAGER",
      scope: "SELECTED",
      portfolioIds: [eastPortfolio.id],
      propertyIds: [west.id],
      responsibilities: ["Operational monitoring"],
      toolPermissions: ["portfolio.summary", "background_job.retry"],
    }));
    expect(receptionist.role).toBe("RECEPTIONIST");
    expect(manager.role).toBe("PROPERTY_MANAGER");
    expect(manager.portfolios[0]?.portfolioId).toBe(eastPortfolio.id);
    expect(manager.properties[0]?.propertyId).toBe(west.id);
    expect(await listAIEmployees(owner.id, organisation.id)).toHaveLength(2);
    await expect(createAIEmployee(viewer.id, organisation.id, employeeInput({ name: "Unauthorised" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("enforces employee tools, property scope, linked autonomy, receptionist intake, and inactive status", async () => {
    const { owner, administrator, organisation, east, west } = await fixture();
    const policy = await upsertAutonomyPolicy(owner.id, organisation.id, { actionKey: "maintenance.create", enabled: true, level: "APPROVAL_REQUIRED", propertyId: east.id, timezone: "UTC" });
    const receptionist = await createAIEmployee(owner.id, organisation.id, employeeInput({
      scope: "SELECTED",
      propertyIds: [east.id],
      toolPermissions: ["maintenance.create"],
      autonomyPolicyIds: [policy.id],
    }));
    const proposalActivity = await receptionistMaintenanceIntake(owner.id, organisation.id, receptionist.id, {
      propertyId: east.id,
      title: "Leaking kitchen tap",
      description: "Tenant reports a continuous kitchen tap leak.",
      category: "plumbing",
      priority: "URGENT",
      customerRequestedHuman: false,
      idempotencyKey: "reception-east-leak-1",
    });
    expect(proposalActivity).toMatchObject({ type: "PROPOSAL", status: "PENDING", actionKey: "maintenance.create" });
    expect(await db.maintenanceRequest.count({ where: { organisationId: organisation.id } })).toBe(0);
    expect(await db.aIActionProposal.count({ where: { organisationId: organisation.id, toolKey: "maintenance.create" } })).toBe(1);
    const proposal = await db.aIActionProposal.findFirstOrThrow({ where: { organisationId: organisation.id, toolKey: "maintenance.create" } });
    await decideAIProposal(administrator.id, organisation.id, proposal.id, { decision: "APPROVE", reason: "Scoped maintenance intake reviewed." });
    expect(await db.maintenanceRequest.count({ where: { organisationId: organisation.id } })).toBe(1);
    expect(await db.aIEmployeeActivity.findUniqueOrThrow({ where: { id: proposalActivity.id } })).toMatchObject({ status: "COMPLETED", humanApproverId: administrator.id });
    await expect(receptionistMaintenanceIntake(owner.id, organisation.id, receptionist.id, {
      propertyId: west.id,
      title: "Out-of-scope issue",
      description: "This property is not assigned.",
      category: "other",
      priority: "NORMAL",
      customerRequestedHuman: false,
      idempotencyKey: "reception-west-issue-1",
    })).rejects.toMatchObject({ code: "AI_EMPLOYEE_SCOPE_DENIED" });
    await expect(executeEmployeeAction(owner.id, organisation.id, receptionist.id, { actionKey: "background_job.retry", arguments: { jobId: crypto.randomUUID() }, reason: "Retry job.", idempotencyKey: "denied-tool-123" })).rejects.toMatchObject({ code: "AI_EMPLOYEE_TOOL_DENIED" });
    await expect(executeEmployeeAction(owner.id, organisation.id, receptionist.id, { actionKey: "payment.reverse", arguments: {}, reason: "Unsafe action.", idempotencyKey: "prohibited-1234" })).rejects.toMatchObject({ code: "AI_EMPLOYEE_TOOL_DENIED" });
    await updateAIEmployee(owner.id, organisation.id, receptionist.id, { status: "INACTIVE" });
    await expect(receptionistMaintenanceIntake(owner.id, organisation.id, receptionist.id, {
      propertyId: east.id, title: "Inactive intake", description: "Should not execute.", category: "other", priority: "NORMAL", customerRequestedHuman: false, idempotencyKey: "inactive-intake-1",
    })).rejects.toMatchObject({ code: "AI_EMPLOYEE_INACTIVE" });
  });

  it("derives scoped property-manager signals, queues, and deterministic metrics without provider credentials", async () => {
    const { owner, organisation, east, west } = await fixture();
    process.env.AI_PROVIDER = "openai-compatible";
    delete process.env.AI_PROVIDER_API_KEY;
    const manager = await createAIEmployee(owner.id, organisation.id, employeeInput({ name: "Kofi", role: "PROPERTY_MANAGER", scope: "SELECTED", propertyIds: [east.id], toolPermissions: ["portfolio.summary"] }));
    await db.maintenanceRequest.create({ data: { organisationId: organisation.id, propertyId: east.id, reportedByUserId: owner.id, title: "East emergency", description: "Urgent scoped issue.", category: "other", priority: "EMERGENCY" } });
    await db.maintenanceRequest.create({ data: { organisationId: organisation.id, propertyId: west.id, reportedByUserId: owner.id, title: "West emergency", description: "Must remain outside scope.", category: "other", priority: "EMERGENCY" } });
    await db.aIActivity.create({
      data: { organisationId: organisation.id, type: "RECOMMENDATION", status: "RECORDED", severity: "HIGH", conditionKey: "maintenance.emergency_unresolved", policyDecision: "MONITOR_ONLY", reason: "East issue.", triggeringCondition: {}, affectedEntities: [{ type: "property", id: east.id }], idempotencyKey: "east-signal", aiProviderKey: "deterministic" },
    });
    await db.aIActivity.create({
      data: { organisationId: organisation.id, type: "RECOMMENDATION", status: "RECORDED", severity: "HIGH", conditionKey: "maintenance.emergency_unresolved", policyDecision: "MONITOR_ONLY", reason: "West issue.", triggeringCondition: {}, affectedEntities: [{ type: "property", id: west.id }], idempotencyKey: "west-signal", aiProviderKey: "deterministic" },
    });
    const workspace = await getAIEmployeeWorkspace(owner.id, organisation.id, manager.id);
    expect(workspace.employee.providerKey).toBe("deterministic");
    expect(workspace.metrics).toMatchObject({ operationalSignals: 1, openMaintenance: 1 });
    expect(workspace.queue.attentionRequired).toHaveLength(1);
    expect(JSON.stringify(workspace)).not.toContain("West issue");
  });

  it("routes uncertain receptionist work to structured human handoff and preserves employee audit attribution", async () => {
    const { owner, organisation, otherOrganisation, managerMember, east } = await fixture();
    const receptionist = await createAIEmployee(owner.id, organisation.id, employeeInput({ propertyIds: [east.id] }));
    const handoff = await receptionistMaintenanceIntake(owner.id, organisation.id, receptionist.id, {
      propertyId: east.id,
      title: "Unclear electrical concern",
      description: "The caller cannot explain whether there is smoke.",
      category: "electrical",
      priority: "EMERGENCY",
      customerRequestedHuman: true,
      idempotencyKey: "human-handoff-1",
    });
    expect(handoff).toMatchObject({ aiEmployeeId: receptionist.id, status: "OPEN", urgency: "CRITICAL" });
    const assigned = await createAIEmployeeHandoff(owner.id, organisation.id, receptionist.id, {
      reason: "Configured escalation threshold reached.",
      urgency: "HIGH",
      assignedMemberId: managerMember.id,
      contextSummary: "Follow up with the tenant and electrician.",
    });
    expect(assigned.status).toBe("ASSIGNED");
    const resolved = await updateAIEmployeeHandoff(owner.id, organisation.id, receptionist.id, assigned.id, { status: "RESOLVED" });
    expect(resolved.assignedMemberId).toBe(managerMember.id);
    const foreignMember = await db.organisationMember.findFirstOrThrow({ where: { organisationId: otherOrganisation.id } });
    await expect(updateAIEmployeeHandoff(owner.id, organisation.id, receptionist.id, assigned.id, { status: "ASSIGNED", assignedMemberId: foreignMember.id })).rejects.toMatchObject({ code: "AI_HANDOFF_ASSIGNEE_INVALID" });
    const audit = await db.auditEvent.findFirstOrThrow({ where: { organisationId: organisation.id, action: "ai.employee.handoff_created", entityId: assigned.id } });
    expect(audit.metadata).toMatchObject({ aiEmployeeId: receptionist.id });
    expect((await getAIEmployeeWorkspace(owner.id, organisation.id, receptionist.id)).queue.escalations).toHaveLength(1);
    expect(await db.aIEmployeeHandoff.count({ where: { aiEmployeeId: receptionist.id } })).toBe(2);
  });

  it("detects overlap, assigns one deterministic owner, prevents duplicate autonomous execution, and isolates organisations", async () => {
    const { owner, outsider, organisation, otherOrganisation } = await fixture();
    const policy = await upsertAutonomyPolicy(owner.id, organisation.id, { actionKey: "background_job.retry", enabled: true, level: "AUTO_EXECUTE", timezone: "UTC" });
    const first = await createAIEmployee(owner.id, organisation.id, employeeInput({ name: "Kofi", role: "PROPERTY_MANAGER", toolPermissions: ["background_job.retry"], autonomyPolicyIds: [policy.id] }));
    const second = await createAIEmployee(owner.id, organisation.id, employeeInput({ name: "Adwoa", role: "PROPERTY_MANAGER", toolPermissions: ["background_job.retry"], autonomyPolicyIds: [policy.id] }));
    expect((await detectAIEmployeeAssignmentConflicts(owner.id, organisation.id, "PROPERTY_MANAGER")).length).toBeGreaterThan(0);
    const job = await db.backgroundJob.create({ data: { organisationId: organisation.id, type: "test.retryable", idempotencyKey: "phase16-failed-job", payload: {}, status: "FAILED", attempts: 1, maxAttempts: 3, lastError: "Temporary failure" } });
    const executed = await executeEmployeeAction(owner.id, organisation.id, first.id, { actionKey: "background_job.retry", arguments: { jobId: job.id }, reason: "Retry the eligible failed job.", idempotencyKey: "employee-job-retry-1" });
    expect(executed).toMatchObject({ type: "AUTO_EXECUTION", status: "COMPLETED", aiEmployeeId: first.id });
    await expect(executeEmployeeAction(owner.id, organisation.id, first.id, { actionKey: "background_job.retry", arguments: { jobId: job.id }, reason: "Network retry of the same command.", idempotencyKey: "employee-job-retry-1" })).rejects.toMatchObject({ code: "AI_EMPLOYEE_DUPLICATE_ACTION" });
    expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: "background_job.retry_requested", entityId: job.id } })).toBe(1);
    await expect(executeEmployeeAction(owner.id, organisation.id, second.id, { actionKey: "background_job.retry", arguments: { jobId: job.id }, reason: "Duplicate overlapping retry.", idempotencyKey: "employee-job-retry-2" })).rejects.toMatchObject({ code: "AI_EMPLOYEE_ASSIGNMENT_CONFLICT" });
    expect(await db.aIEmployeeActivity.count({ where: { organisationId: organisation.id, actionKey: "background_job.retry", status: "COMPLETED" } })).toBe(1);
    await expect(getAIEmployeeWorkspace(outsider.id, otherOrganisation.id, first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: "ai.employee.action_executed", metadata: { path: ["aiEmployeeId"], equals: first.id } } })).toBe(1);
  });
});
