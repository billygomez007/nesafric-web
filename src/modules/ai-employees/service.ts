import { Prisma, type AIEmployeeRole } from "@/platform/database/generated/client";
import {
  AUTO_EXECUTE_ACTION_ALLOWLIST,
  createAIProposal,
  createAISession,
  executeAIActionThroughDomainService,
  executeAIReadThroughTool,
  getAIActionPolicyMetadata,
  listAIActionPolicyMetadata,
  listAIReadToolMetadata,
} from "@/modules/ai/service";
import { getAIProvider } from "@/modules/ai/providers";
import { platformAutomationPaused } from "@/modules/ai-autonomy/service";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { db } from "@/platform/database/client";
import { AppError, notFound } from "@/platform/errors";
import { assertFeatureEnabled, assertOperational } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import {
  aiEmployeeSchema,
  aiEmployeeUpdateSchema,
  employeeActionSchema,
  handoffSchema,
  handoffStatusSchema,
  receptionistIntakeSchema,
} from "./schemas";

const employeeInclude = {
  portfolios: { include: { portfolio: { select: { id: true, name: true } } } },
  properties: { include: { property: { select: { id: true, name: true, portfolioId: true } } } },
  toolPermissions: true,
  autonomyPolicies: { include: { policy: true } },
} satisfies Prisma.AIEmployeeInclude;

async function validateAssignments(
  organisationId: string,
  portfolioIds: string[],
  propertyIds: string[],
  autonomyPolicyIds: string[],
) {
  const [portfolios, properties, policies] = await Promise.all([
    db.portfolio.count({ where: { id: { in: portfolioIds }, organisationId, archivedAt: null } }),
    db.property.count({ where: { id: { in: propertyIds }, organisationId, archivedAt: null } }),
    db.aIAutonomyPolicy.count({ where: { id: { in: autonomyPolicyIds }, organisationId } }),
  ]);
  if (portfolios !== new Set(portfolioIds).size || properties !== new Set(propertyIds).size || policies !== new Set(autonomyPolicyIds).size) {
    throw new AppError("AI_EMPLOYEE_SCOPE_INVALID", 422, "One or more assignments do not belong to this organisation.");
  }
}

function validateTools(toolKeys: string[]) {
  const catalog = new Set([
    ...listAIReadToolMetadata().map(({ toolKey }) => toolKey),
    ...listAIActionPolicyMetadata().map(({ actionKey }) => actionKey),
  ]);
  if (toolKeys.some((key) => !catalog.has(key))) {
    throw new AppError("AI_EMPLOYEE_TOOL_INVALID", 422, "One or more employee tools are not in the controlled catalog.");
  }
}

export async function createAIEmployee(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.aiEmployeeManage);
  // Representative entitlement check (item 2): AI employee headcount is capped per plan.
  await assertOperational(organisationId, ENTITLEMENTS.aiEmployeesMax.key);
  const data = aiEmployeeSchema.parse(input);
  validateTools(data.toolPermissions);
  await validateAssignments(organisationId, data.portfolioIds, data.propertyIds, data.autonomyPolicyIds);
  const provider = getAIProvider();
  return db.$transaction(async (tx) => {
    const employee = await tx.aIEmployee.create({
      data: {
        organisationId,
        name: data.name,
        role: data.role,
        description: data.description,
        status: data.status,
        scope: data.scope,
        responsibilities: data.responsibilities,
        instructions: data.instructions as Prisma.InputJsonValue,
        escalationConfiguration: data.escalationConfiguration as Prisma.InputJsonValue,
        workingHours: data.workingHours as Prisma.InputJsonValue | undefined,
        timezone: data.timezone,
        providerKey: data.providerKey ?? provider.key,
        modelKey: data.modelKey,
        createdByUserId: userId,
        updatedByUserId: userId,
        portfolios: { create: data.portfolioIds.map((portfolioId) => ({ portfolioId })) },
        properties: { create: data.propertyIds.map((propertyId) => ({ propertyId })) },
        toolPermissions: { create: data.toolPermissions.map((toolKey) => ({ toolKey })) },
        autonomyPolicies: { create: data.autonomyPolicyIds.map((policyId) => ({ policyId })) },
      },
      include: employeeInclude,
    });
    await tx.auditEvent.create({
      data: { organisationId, actorUserId: userId, action: "ai.employee.created", entityType: "ai_employee", entityId: employee.id, metadata: { aiEmployeeId: employee.id, role: employee.role, scope: employee.scope } },
    });
    await tx.domainEvent.create({ data: { organisationId, name: "ai.employee.created", aggregateType: "ai_employee", aggregateId: employee.id, payload: { role: employee.role, scope: employee.scope } } });
    return employee;
  });
}

export async function updateAIEmployee(userId: string, organisationId: string, employeeId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.aiEmployeeManage);
  const current = await db.aIEmployee.findFirst({ where: { id: employeeId, organisationId, archivedAt: null }, include: employeeInclude });
  if (!current) throw notFound();
  const patch = aiEmployeeUpdateSchema.parse(input);
  const supplied = input as Record<string, unknown>;
  const merged = aiEmployeeSchema.parse({
    name: patch.name ?? current.name,
    role: patch.role ?? current.role,
    description: patch.description ?? current.description ?? undefined,
    status: patch.status === "ARCHIVED" ? "INACTIVE" : (patch.status ?? current.status),
    scope: patch.scope ?? current.scope,
    portfolioIds: Object.hasOwn(supplied, "portfolioIds") ? patch.portfolioIds : current.portfolios.map(({ portfolioId }) => portfolioId),
    propertyIds: Object.hasOwn(supplied, "propertyIds") ? patch.propertyIds : current.properties.map(({ propertyId }) => propertyId),
    responsibilities: Object.hasOwn(supplied, "responsibilities") ? patch.responsibilities : current.responsibilities,
    instructions: Object.hasOwn(supplied, "instructions") ? patch.instructions : current.instructions,
    escalationConfiguration: Object.hasOwn(supplied, "escalationConfiguration") ? patch.escalationConfiguration : current.escalationConfiguration,
    workingHours: patch.workingHours ?? current.workingHours ?? undefined,
    timezone: Object.hasOwn(supplied, "timezone") ? patch.timezone : current.timezone,
    providerKey: patch.providerKey ?? current.providerKey ?? undefined,
    modelKey: patch.modelKey ?? current.modelKey ?? undefined,
    toolPermissions: patch.toolPermissions ?? current.toolPermissions.map(({ toolKey }) => toolKey),
    autonomyPolicyIds: Object.hasOwn(supplied, "autonomyPolicyIds") ? patch.autonomyPolicyIds : current.autonomyPolicies.map(({ policyId }) => policyId),
  });
  validateTools(merged.toolPermissions);
  await validateAssignments(organisationId, merged.portfolioIds, merged.propertyIds, merged.autonomyPolicyIds);
  return db.$transaction(async (tx) => {
    await Promise.all([
      tx.aIEmployeePortfolio.deleteMany({ where: { aiEmployeeId: employeeId } }),
      tx.aIEmployeeProperty.deleteMany({ where: { aiEmployeeId: employeeId } }),
      tx.aIEmployeeToolPermission.deleteMany({ where: { aiEmployeeId: employeeId } }),
      tx.aIEmployeeAutonomyPolicy.deleteMany({ where: { aiEmployeeId: employeeId } }),
    ]);
    const employee = await tx.aIEmployee.update({
      where: { id: employeeId },
      data: {
        name: merged.name,
        role: merged.role,
        description: merged.description,
        status: patch.status ?? merged.status,
        scope: merged.scope,
        responsibilities: merged.responsibilities,
        instructions: merged.instructions as Prisma.InputJsonValue,
        escalationConfiguration: merged.escalationConfiguration as Prisma.InputJsonValue,
        workingHours: merged.workingHours as Prisma.InputJsonValue | undefined,
        timezone: merged.timezone,
        providerKey: merged.providerKey,
        modelKey: merged.modelKey,
        updatedByUserId: userId,
        archivedAt: patch.status === "ARCHIVED" ? new Date() : undefined,
        portfolios: { create: merged.portfolioIds.map((portfolioId) => ({ portfolioId })) },
        properties: { create: merged.propertyIds.map((propertyId) => ({ propertyId })) },
        toolPermissions: { create: merged.toolPermissions.map((toolKey) => ({ toolKey })) },
        autonomyPolicies: { create: merged.autonomyPolicyIds.map((policyId) => ({ policyId })) },
      },
      include: employeeInclude,
    });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "ai.employee.updated", entityType: "ai_employee", entityId: employee.id, metadata: { aiEmployeeId: employee.id, status: employee.status } } });
    return employee;
  });
}

export async function listAIEmployees(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.aiEmployeeRead);
  return db.aIEmployee.findMany({ where: { organisationId, archivedAt: null }, include: employeeInclude, orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
}

export async function getAIEmployeeDirectory(userId: string, organisationId: string) {
  const employees = await listAIEmployees(userId, organisationId);
  const [portfolios, properties, policies] = await Promise.all([
    db.portfolio.findMany({ where: { organisationId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.property.findMany({ where: { organisationId, archivedAt: null }, select: { id: true, name: true, portfolioId: true }, orderBy: { name: "asc" } }),
    db.aIAutonomyPolicy.findMany({ where: { organisationId, enabled: true }, select: { id: true, actionKey: true, level: true, propertyId: true }, orderBy: { actionKey: "asc" } }),
  ]);
  return {
    employees,
    portfolios,
    properties,
    policies,
    toolCatalog: {
      read: listAIReadToolMetadata(),
      actions: listAIActionPolicyMetadata(),
    },
  };
}

async function requireEmployee(userId: string, organisationId: string, employeeId: string, operate = false) {
  await requirePermission(userId, organisationId, operate ? PERMISSIONS.aiEmployeeOperate : PERMISSIONS.aiEmployeeRead);
  const employee = await db.aIEmployee.findFirst({ where: { id: employeeId, organisationId, archivedAt: null }, include: employeeInclude });
  if (!employee) throw notFound();
  if (operate && employee.status !== "ACTIVE") throw new AppError("AI_EMPLOYEE_INACTIVE", 409, "Inactive AI employees cannot execute or propose actions.");
  return employee;
}

async function employeePropertyIds(employee: Awaited<ReturnType<typeof requireEmployee>>) {
  if (employee.scope === "ORGANISATION") {
    return (await db.property.findMany({ where: { organisationId: employee.organisationId, archivedAt: null }, select: { id: true } })).map(({ id }) => id);
  }
  const direct = employee.properties.map(({ propertyId }) => propertyId);
  const portfolioIds = employee.portfolios.map(({ portfolioId }) => portfolioId);
  const portfolioProperties = await db.property.findMany({ where: { organisationId: employee.organisationId, portfolioId: { in: portfolioIds }, archivedAt: null }, select: { id: true } });
  return [...new Set([...direct, ...portfolioProperties.map(({ id }) => id)])];
}

async function actionPropertyId(organisationId: string, input: Record<string, unknown>) {
  if (typeof input.propertyId === "string") return input.propertyId;
  if (typeof input.unitId === "string") return (await db.unit.findFirst({ where: { id: input.unitId, property: { organisationId } }, select: { propertyId: true } }))?.propertyId;
  if (typeof input.leaseId === "string") return (await db.lease.findFirst({ where: { id: input.leaseId, organisationId }, select: { propertyId: true } }))?.propertyId;
  if (typeof input.maintenanceRequestId === "string") return (await db.maintenanceRequest.findFirst({ where: { id: input.maintenanceRequestId, organisationId }, select: { propertyId: true } }))?.propertyId;
  if (typeof input.workOrderId === "string") return (await db.workOrder.findFirst({ where: { id: input.workOrderId, organisationId }, select: { propertyId: true } }))?.propertyId;
  if (typeof input.viewingRequestId === "string") return (await db.viewingRequest.findFirst({ where: { id: input.viewingRequestId, organisationId }, select: { listing: { select: { propertyId: true } } } }))?.listing.propertyId;
  if (typeof input.leadId === "string") return (await db.marketplaceLead.findFirst({ where: { id: input.leadId, organisationId }, select: { listing: { select: { propertyId: true } } } }))?.listing.propertyId;
  return undefined;
}

async function enforceScope(employee: Awaited<ReturnType<typeof requireEmployee>>, propertyId: string | undefined) {
  if (employee.scope === "ORGANISATION") return;
  if (!propertyId || !(await employeePropertyIds(employee)).includes(propertyId)) {
    throw new AppError("AI_EMPLOYEE_SCOPE_DENIED", 403, "The AI employee is not assigned to the affected property.");
  }
}

async function deterministicOwner(employee: Awaited<ReturnType<typeof requireEmployee>>, propertyId: string | undefined, toolKey: string) {
  const candidates = await db.aIEmployee.findMany({
    where: {
      organisationId: employee.organisationId,
      role: employee.role,
      status: "ACTIVE",
      archivedAt: null,
      toolPermissions: { some: { toolKey } },
      ...(propertyId ? {
        OR: [
          { scope: "ORGANISATION" },
          { properties: { some: { propertyId } } },
          { portfolios: { some: { portfolio: { properties: { some: { id: propertyId } } } } } },
        ],
      } : { scope: "ORGANISATION" }),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return candidates[0]?.id === employee.id;
}

function withinPolicyWindow(start: number | null, end: number | null, timezone: string) {
  if (start === null || end === null || start === end) return true;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const minute = Number(parts.find(({ type }) => type === "hour")?.value ?? 0) * 60 + Number(parts.find(({ type }) => type === "minute")?.value ?? 0);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

async function claimEmployeeActivity(input: {
  organisationId: string;
  employeeId: string;
  type: string;
  actionKey?: string;
  policyDecision?: string;
  reason: string;
  affectedEntities: Array<{ type: string; id: string }>;
  idempotencyKey: string;
  userId?: string;
}) {
  const created = await db.aIEmployeeActivity.createMany({
    data: {
      organisationId: input.organisationId,
      aiEmployeeId: input.employeeId,
      type: input.type,
      status: "PROCESSING",
      actionKey: input.actionKey,
      policyDecision: input.policyDecision,
      reason: input.reason,
      affectedEntities: input.affectedEntities,
      idempotencyKey: input.idempotencyKey,
      triggeringUserId: input.userId,
    },
    skipDuplicates: true,
  });
  if (!created.count) throw new AppError("AI_EMPLOYEE_DUPLICATE_ACTION", 409, "This employee action has already been recorded.");
  return db.aIEmployeeActivity.findUniqueOrThrow({ where: { organisationId_idempotencyKey: { organisationId: input.organisationId, idempotencyKey: input.idempotencyKey } } });
}

export async function executeEmployeeAction(userId: string, organisationId: string, employeeId: string, input: unknown) {
  const employee = await requireEmployee(userId, organisationId, employeeId, true);
  const data = employeeActionSchema.parse(input);
  if (!employee.toolPermissions.some(({ toolKey }) => toolKey === data.actionKey)) throw new AppError("AI_EMPLOYEE_TOOL_DENIED", 403, "The AI employee is not permitted to use this action.");
  const metadata = getAIActionPolicyMetadata(data.actionKey);
  if (!metadata) throw new AppError("AI_ACTION_NOT_ALLOWED", 400, "The action is not supported.");
  const propertyId = await actionPropertyId(organisationId, data.arguments);
  await enforceScope(employee, propertyId);
  const policy = employee.autonomyPolicies.map(({ policy }) => policy)
    .filter(({ enabled, actionKey }) => enabled && actionKey === data.actionKey)
    .find(({ propertyId: policyPropertyId }) => !policyPropertyId || policyPropertyId === propertyId);
  if (!policy || policy.level === "DISABLED") throw new AppError("AI_EMPLOYEE_POLICY_BLOCKED", 403, "No linked autonomy policy permits this action.");
  const affected = propertyId ? [{ type: "property", id: propertyId }] : [];
  const activityInput = { organisationId, employeeId, actionKey: data.actionKey, policyDecision: policy.level, reason: data.reason, affectedEntities: affected, idempotencyKey: data.idempotencyKey, userId };
  if (policy.level === "RECOMMEND_ONLY") {
    const activity = await claimEmployeeActivity({ ...activityInput, type: "RECOMMENDATION" });
    return db.aIEmployeeActivity.update({ where: { id: activity.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  }
  if (policy.level === "APPROVAL_REQUIRED") {
    const activity = await claimEmployeeActivity({ ...activityInput, type: "PROPOSAL" });
    try {
      const session = await createAISession(userId, organisationId, { title: `${employee.name} proposal` });
      const proposal = await createAIProposal(userId, organisationId, { sessionId: session.id, toolKey: data.actionKey, arguments: data.arguments, reason: data.reason, explanation: `${employee.name} proposed this action within assigned scope. It has not executed.` });
      return db.$transaction(async (tx) => {
        const updated = await tx.aIEmployeeActivity.update({ where: { id: activity.id }, data: { status: "PENDING", result: { proposalId: proposal.id } } });
        await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "ai.employee.proposal_created", entityType: "ai_employee_activity", entityId: activity.id, metadata: { aiEmployeeId: employeeId, proposalId: proposal.id, policyId: policy.id } } });
        return updated;
      });
    } catch (error) {
      await db.aIEmployeeActivity.update({ where: { id: activity.id }, data: { status: "FAILED", failureCode: error instanceof AppError ? error.code : "AI_EMPLOYEE_PROPOSAL_FAILED", failureMessage: error instanceof Error ? error.message : "Proposal creation failed.", completedAt: new Date() } });
      throw error;
    }
  }
  const configuration = await db.aIAutonomyConfiguration.findUnique({ where: { organisationId } });
  if (!configuration?.enabled || configuration.automationPaused || platformAutomationPaused()) {
    throw new AppError("AI_AUTOMATION_PAUSED", 409, "AI automation is disabled or paused by organisation or platform policy.");
  }
  // Representative entitlement check (item 2): auto-execution is a plan-gated capability distinct
  // from RBAC/autonomy policy — a plan without it still allows RECOMMEND_ONLY/APPROVAL_REQUIRED
  // policies, just never unattended auto-execution.
  await assertFeatureEnabled(organisationId, ENTITLEMENTS.automationEnabled.key);
  if (!withinPolicyWindow(policy.executionWindowStartMinute, policy.executionWindowEndMinute, policy.timezone)) {
    throw new AppError("AI_AUTOMATION_WINDOW_BLOCKED", 409, "This action is outside its configured execution window.");
  }
  if (!configuration.communicationAllowed && data.actionKey === "reminder.send") {
    throw new AppError("AI_AUTOMATION_COMMUNICATION_BLOCKED", 409, "Organisation policy currently blocks autonomous communications.");
  }
  if (policy.maxExecutions && policy.frequencyWindowMinutes) {
    const recentActivities = await db.aIEmployeeActivity.findMany({
      where: {
        organisationId,
        aiEmployeeId: employee.id,
        actionKey: data.actionKey,
        type: "AUTO_EXECUTION",
        status: "COMPLETED",
        createdAt: { gte: new Date(Date.now() - policy.frequencyWindowMinutes * 60_000) },
      },
      select: { affectedEntities: true },
    });
    const recent = propertyId
      ? recentActivities.filter(({ affectedEntities }) => Array.isArray(affectedEntities) && affectedEntities.some((entity) => (entity as { type?: unknown; id?: unknown }).type === "property" && (entity as { id?: unknown }).id === propertyId)).length
      : recentActivities.length;
    if (recent >= policy.maxExecutions) throw new AppError("AI_AUTOMATION_FREQUENCY_BLOCKED", 409, "The configured autonomous-action frequency limit has been reached.");
  }
  if (!AUTO_EXECUTE_ACTION_ALLOWLIST.has(data.actionKey)) throw new AppError("AI_ACTION_NOT_AUTO_EXECUTE_ELIGIBLE", 403, "Platform policy does not allow this action to auto-execute.");
  if (!(await deterministicOwner(employee, propertyId, data.actionKey))) throw new AppError("AI_EMPLOYEE_ASSIGNMENT_CONFLICT", 409, "Another overlapping AI employee owns this operational action.");
  const activity = await claimEmployeeActivity({ ...activityInput, type: "AUTO_EXECUTION" });
  try {
    const execution = await executeAIActionThroughDomainService(userId, organisationId, data.actionKey, data.arguments);
    return db.$transaction(async (tx) => {
      const completed = await tx.aIEmployeeActivity.update({ where: { id: activity.id }, data: { status: "COMPLETED", affectedEntities: execution.affectedEntities, result: { resultId: execution.result.id }, completedAt: new Date() } });
      await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "ai.employee.action_executed", entityType: "ai_employee_activity", entityId: activity.id, metadata: { aiEmployeeId: employeeId, policyId: policy.id, resultId: execution.result.id } } });
      await tx.domainEvent.create({ data: { organisationId, name: "ai.employee.action_executed", aggregateType: "ai_employee", aggregateId: employeeId, payload: { activityId: activity.id, actionKey: data.actionKey, resultId: execution.result.id } } });
      return completed;
    });
  } catch (error) {
    await db.aIEmployeeActivity.update({ where: { id: activity.id }, data: { status: "FAILED", failureCode: error instanceof AppError ? error.code : "AI_EMPLOYEE_ACTION_FAILED", failureMessage: error instanceof Error ? error.message : "Employee action failed.", completedAt: new Date() } });
    throw error;
  }
}

export async function executeEmployeeReadTool(userId: string, organisationId: string, employeeId: string, toolKey: string, input: unknown = {}) {
  const employee = await requireEmployee(userId, organisationId, employeeId, true);
  if (!employee.toolPermissions.some((permission) => permission.toolKey === toolKey)) throw new AppError("AI_EMPLOYEE_TOOL_DENIED", 403, "The AI employee is not permitted to use this tool.");
  const propertyId = await actionPropertyId(organisationId, input as Record<string, unknown>);
  await enforceScope(employee, propertyId);
  if (employee.scope !== "ORGANISATION" && !propertyId) throw new AppError("AI_EMPLOYEE_SCOPE_REQUIRED", 422, "This tool cannot safely operate without a property identifier for a scoped employee.");
  return executeAIReadThroughTool(userId, organisationId, toolKey, input);
}

export async function receptionistMaintenanceIntake(userId: string, organisationId: string, employeeId: string, input: unknown) {
  const employee = await requireEmployee(userId, organisationId, employeeId, true);
  if (employee.role !== "RECEPTIONIST") throw new AppError("AI_EMPLOYEE_ROLE_INVALID", 409, "Maintenance intake requires an AI receptionist.");
  const data = receptionistIntakeSchema.parse(input);
  if (data.customerRequestedHuman || data.uncertaintyReason) {
    return createAIEmployeeHandoff(userId, organisationId, employeeId, {
      operationalItemType: "maintenance_intake",
      operationalItemId: data.idempotencyKey,
      reason: data.customerRequestedHuman ? "Customer requested a human." : data.uncertaintyReason,
      urgency: data.priority === "EMERGENCY" ? "CRITICAL" : data.priority === "URGENT" ? "HIGH" : "MEDIUM",
      contextSummary: `${data.title}: ${data.description}`,
    });
  }
  return executeEmployeeAction(userId, organisationId, employeeId, {
    actionKey: "maintenance.create",
    arguments: { propertyId: data.propertyId, unitId: data.unitId, title: data.title, description: data.description, category: data.category, priority: data.priority, attachments: [] },
    reason: "Receptionist captured a maintenance issue for controlled review.",
    idempotencyKey: data.idempotencyKey,
  });
}

export async function createAIEmployeeHandoff(userId: string, organisationId: string, employeeId: string, input: unknown) {
  const employee = await requireEmployee(userId, organisationId, employeeId, true);
  const data = handoffSchema.parse(input);
  if (data.assignedMemberId) {
    const member = await db.organisationMember.findFirst({ where: { id: data.assignedMemberId, organisationId, status: "ACTIVE", archivedAt: null } });
    if (!member) throw new AppError("AI_HANDOFF_ASSIGNEE_INVALID", 422, "The handoff assignee is not an active organisation member.");
  }
  return db.$transaction(async (tx) => {
    const handoff = await tx.aIEmployeeHandoff.create({ data: { organisationId, aiEmployeeId: employee.id, ...data, status: data.assignedMemberId ? "ASSIGNED" : "OPEN", createdByUserId: userId } });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "ai.employee.handoff_created", entityType: "ai_employee_handoff", entityId: handoff.id, metadata: { aiEmployeeId: employee.id, urgency: handoff.urgency } } });
    await tx.domainEvent.create({ data: { organisationId, name: "ai.employee.handoff_created", aggregateType: "ai_employee", aggregateId: employee.id, payload: { handoffId: handoff.id, urgency: handoff.urgency } } });
    return handoff;
  });
}

export async function updateAIEmployeeHandoff(userId: string, organisationId: string, employeeId: string, handoffId: string, input: unknown) {
  await requireEmployee(userId, organisationId, employeeId, true);
  const data = handoffStatusSchema.parse(input);
  const existing = await db.aIEmployeeHandoff.findFirst({ where: { id: handoffId, aiEmployeeId: employeeId, organisationId } });
  if (!existing) throw notFound();
  const assignedMemberId = data.assignedMemberId ?? existing.assignedMemberId;
  if (data.status === "ASSIGNED" && !assignedMemberId) throw new AppError("AI_HANDOFF_ASSIGNEE_REQUIRED", 422, "Assigned handoffs require an active organisation member.");
  if (assignedMemberId) {
    const member = await db.organisationMember.findFirst({ where: { id: assignedMemberId, organisationId, status: "ACTIVE", archivedAt: null } });
    if (!member) throw new AppError("AI_HANDOFF_ASSIGNEE_INVALID", 422, "The handoff assignee is not an active organisation member.");
  }
  return db.aIEmployeeHandoff.update({ where: { id: handoffId }, data: { status: data.status, assignedMemberId, resolvedAt: ["RESOLVED", "CLOSED"].includes(data.status) ? new Date() : null } });
}

function entityPropertyId(entity: { type?: unknown; id?: unknown }, leaseProperties: Map<string, string>) {
  if (entity.type === "property" && typeof entity.id === "string") return entity.id;
  if (entity.type === "lease" && typeof entity.id === "string") return leaseProperties.get(entity.id);
  return undefined;
}

export async function getAIEmployeeWorkspace(userId: string, organisationId: string, employeeId: string) {
  const employee = await requireEmployee(userId, organisationId, employeeId);
  const propertyIds = await employeePropertyIds(employee);
  const [activities, handoffs, operational, leaseRows, properties, portfolios] = await Promise.all([
    db.aIEmployeeActivity.findMany({ where: { aiEmployeeId: employee.id, organisationId }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.aIEmployeeHandoff.findMany({ where: { aiEmployeeId: employee.id, organisationId }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.aIActivity.findMany({ where: { organisationId }, include: { escalation: true, proposal: { select: { id: true, status: true } } }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.lease.findMany({ where: { organisationId, propertyId: { in: propertyIds } }, select: { id: true, propertyId: true } }),
    db.property.findMany({ where: { organisationId, id: { in: propertyIds } }, select: { id: true, name: true, status: true } }),
    db.portfolio.findMany({ where: { organisationId, id: { in: employee.portfolios.map(({ portfolioId }) => portfolioId) } }, select: { id: true, name: true } }),
  ]);
  const leaseProperties = new Map(leaseRows.map(({ id, propertyId }) => [id, propertyId]));
  const scopedOperational = operational.filter((activity) => {
    if (employee.scope === "ORGANISATION") return true;
    const entities = Array.isArray(activity.affectedEntities) ? activity.affectedEntities : [];
    return entities.some((entity) => propertyIds.includes(entityPropertyId(entity as { type?: unknown; id?: unknown }, leaseProperties) ?? ""));
  });
  const [openMaintenance, overdueRent, expiringLeases] = await Promise.all([
    db.maintenanceRequest.count({ where: { organisationId, propertyId: { in: propertyIds }, status: { in: ["REPORTED", "TRIAGED", "AWAITING_APPROVAL", "APPROVED", "ASSIGNED", "IN_PROGRESS"] } } }),
    db.rentObligation.count({ where: { organisationId, propertyId: { in: propertyIds }, status: "OVERDUE" } }),
    db.lease.count({ where: { organisationId, propertyId: { in: propertyIds }, status: { in: ["ACTIVE", "EXPIRING"] }, endDate: { lte: new Date(Date.now() + 90 * 86_400_000), gte: new Date() } } }),
  ]);
  const [conversationStats, conversationQueue, conversationHandoffs, resolvedConversations] = await Promise.all([
    db.conversation.groupBy({ by: ["status"], where: { organisationId, assignedAIEmployeeId: employee.id }, _count: { _all: true } }),
    db.conversation.findMany({
      where: { organisationId, assignedAIEmployeeId: employee.id, status: { in: ["OPEN", "AI_ACTIVE", "HUMAN_REQUIRED", "WAITING_CUSTOMER"] } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, channel: true, status: true, subject: true, lastMessageAt: true, tenantOrganisationId: true, marketplaceLeadId: true },
    }),
    db.aIEmployeeHandoff.count({ where: { organisationId, aiEmployeeId: employee.id, conversationId: { not: null } } }),
    db.conversation.count({ where: { organisationId, assignedAIEmployeeId: employee.id, status: { in: ["RESOLVED", "CLOSED"] } } }),
  ]);
  const conversationsHandled = conversationStats.reduce((sum, row) => sum + row._count._all, 0);
  return {
    employee,
    assignments: { properties, portfolios },
    queue: {
      newItems: scopedOperational.filter(({ status }) => status === "RECORDED"),
      attentionRequired: scopedOperational.filter(({ severity }) => ["HIGH", "CRITICAL"].includes(severity)),
      pendingProposals: activities.filter(({ type, status }) => type === "PROPOSAL" && status === "PENDING"),
      escalations: handoffs.filter(({ status }) => ["OPEN", "ASSIGNED"].includes(status)),
      completedActions: activities.filter(({ status }) => status === "COMPLETED"),
      failedActions: activities.filter(({ status }) => status === "FAILED"),
    },
    conversations: {
      incomingEnquiries: conversationQueue.filter(({ status }) => status === "OPEN" || status === "AI_ACTIVE").length,
      conversationsHandled,
      unresolvedConversations: conversationQueue.length,
      handoffsRequired: conversationStats.find((row) => row.status === "HUMAN_REQUIRED")?._count._all ?? 0,
      humanHandoffs: conversationHandoffs,
      resolvedConversations,
      responseMetrics: { conversationsHandled, resolvedConversations, openConversations: conversationQueue.length },
      queue: conversationQueue,
    },
    metrics: employee.role === "RECEPTIONIST"
      ? {
          enquiriesHandled: activities.filter(({ type }) => type === "ENQUIRY").length,
          enquiriesEscalated: handoffs.length,
          maintenanceRequestsCreated: activities.filter(({ actionKey, status }) => actionKey === "maintenance.create" && status === "COMPLETED").length,
          viewingsAssisted: activities.filter(({ actionKey }) => actionKey === "viewing.schedule").length,
          responseReadiness: employee.status === "ACTIVE" && employee.toolPermissions.length > 0,
          conversationsHandled,
        }
      : {
          operationalSignals: scopedOperational.length,
          proposalsGenerated: activities.filter(({ type }) => type === "PROPOSAL").length,
          approvedActionsCompleted: activities.filter(({ type, status }) => type === "PROPOSAL" && status === "COMPLETED").length,
          autonomousActionsCompleted: activities.filter(({ type, status }) => type === "AUTO_EXECUTION" && status === "COMPLETED").length,
          escalations: handoffs.length,
          failures: activities.filter(({ status }) => status === "FAILED").length,
          openMaintenance,
          overdueRent,
          expiringLeases,
        },
    conflicts: await detectAIEmployeeAssignmentConflicts(userId, organisationId, employee.role),
  };
}

/**
 * Deterministically select the single AI receptionist responsible for a
 * property (or the whole organisation when no property is known yet). Uses
 * the same oldest-active-employee tie-break as `deterministicOwner` so
 * Phase 17 conversation routing can never let two overlapping receptionists
 * independently claim the same inbound message.
 */
export async function selectReceptionistForProperty(organisationId: string, propertyId?: string | null) {
  const candidates = await db.aIEmployee.findMany({
    where: {
      organisationId,
      role: "RECEPTIONIST",
      status: "ACTIVE",
      archivedAt: null,
      ...(propertyId
        ? {
            OR: [
              { scope: "ORGANISATION" },
              { properties: { some: { propertyId } } },
              { portfolios: { some: { portfolio: { properties: { some: { id: propertyId } } } } } },
            ],
          }
        : { scope: "ORGANISATION" }),
    },
    include: employeeInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return candidates[0] ?? null;
}

export async function detectAIEmployeeAssignmentConflicts(userId: string, organisationId: string, role?: AIEmployeeRole) {
  await requirePermission(userId, organisationId, PERMISSIONS.aiEmployeeRead);
  const employees = await db.aIEmployee.findMany({ where: { organisationId, status: "ACTIVE", archivedAt: null, ...(role ? { role } : {}) }, include: employeeInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const scopes = await Promise.all(employees.map(async (employee) => ({ employee, properties: await employeePropertyIds(employee) })));
  const conflicts: Array<{ propertyId: string; role: AIEmployeeRole; ownerEmployeeId: string; overlappingEmployeeIds: string[] }> = [];
  for (const propertyId of new Set(scopes.flatMap(({ properties }) => properties))) {
    for (const employeeRole of ["RECEPTIONIST", "PROPERTY_MANAGER"] as const) {
      const overlap = scopes.filter(({ employee, properties }) => employee.role === employeeRole && properties.includes(propertyId));
      if (overlap.length > 1) conflicts.push({ propertyId, role: employeeRole, ownerEmployeeId: overlap[0]!.employee.id, overlappingEmployeeIds: overlap.slice(1).map(({ employee }) => employee.id) });
    }
  }
  return conflicts;
}
