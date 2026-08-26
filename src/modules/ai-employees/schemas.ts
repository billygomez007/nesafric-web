import { z } from "zod";

const id = z.string().uuid();
const jsonObject = z.record(z.string(), z.unknown());

const aiEmployeeBaseSchema = z.object({
  name: z.string().trim().min(2).max(100),
  role: z.enum(["RECEPTIONIST", "PROPERTY_MANAGER"]),
  description: z.string().trim().max(1_000).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  scope: z.enum(["ORGANISATION", "SELECTED"]),
  portfolioIds: z.array(id).max(100).default([]),
  propertyIds: z.array(id).max(500).default([]),
  responsibilities: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  instructions: jsonObject.default({}),
  escalationConfiguration: jsonObject.default({}),
  workingHours: jsonObject.optional(),
  timezone: z.string().trim().min(1).max(100).default("UTC"),
  providerKey: z.string().trim().max(100).optional(),
  modelKey: z.string().trim().max(100).optional(),
  toolPermissions: z.array(z.string().trim().min(1).max(100)).max(100),
  autonomyPolicyIds: z.array(id).max(100).default([]),
}).strict();

const validateEmployee = (value: z.infer<typeof aiEmployeeBaseSchema>, context: z.RefinementCtx) => {
  if (value.scope === "SELECTED" && value.portfolioIds.length === 0 && value.propertyIds.length === 0) {
    context.addIssue({ code: "custom", path: ["propertyIds"], message: "Selected scope requires at least one portfolio or property." });
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(new Date());
  } catch {
    context.addIssue({ code: "custom", path: ["timezone"], message: "Timezone must be a valid IANA timezone." });
  }
};

export const aiEmployeeSchema = aiEmployeeBaseSchema.superRefine(validateEmployee);

export const aiEmployeeUpdateSchema = aiEmployeeBaseSchema.partial().extend({
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
}).strict();

export const handoffSchema = z.object({
  conversationId: z.string().trim().max(200).optional(),
  operationalItemType: z.string().trim().max(100).optional(),
  operationalItemId: z.string().trim().max(200).optional(),
  reason: z.string().trim().min(3).max(1_000),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  assignedMemberId: id.optional(),
  assignedTeamReference: z.string().trim().max(200).optional(),
  contextSummary: z.string().trim().min(3).max(2_000),
}).strict();

export const handoffStatusSchema = z.object({
  status: z.enum(["OPEN", "ASSIGNED", "RESOLVED", "CLOSED"]),
  assignedMemberId: id.optional(),
}).strict();

export const employeeActionSchema = z.object({
  actionKey: z.string().trim().min(1).max(100),
  arguments: jsonObject,
  reason: z.string().trim().min(3).max(1_000),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export const receptionistIntakeSchema = z.object({
  propertyId: id,
  unitId: id.optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(5_000),
  category: z.string().trim().min(1).max(100),
  priority: z.enum(["EMERGENCY", "URGENT", "NORMAL", "LOW"]).default("NORMAL"),
  customerRequestedHuman: z.boolean().default(false),
  uncertaintyReason: z.string().trim().max(1_000).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();
