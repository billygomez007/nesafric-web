import { z } from "zod";

const id = z.string().uuid();
const minute = z.number().int().min(0).max(1439);

export const autonomyConfigurationSchema = z.object({
  enabled: z.boolean(),
  defaultLevel: z.enum(["DISABLED", "RECOMMEND_ONLY", "APPROVAL_REQUIRED", "AUTO_EXECUTE"]),
  communicationAllowed: z.boolean(),
  automationActorUserId: id.optional(),
}).strict();

export const autonomyPolicySchema = z.object({
  actionKey: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  level: z.enum(["DISABLED", "RECOMMEND_ONLY", "APPROVAL_REQUIRED", "AUTO_EXECUTE"]),
  propertyId: id.optional(),
  eventType: z.string().trim().min(1).max(100).optional(),
  channel: z.enum(["IN_APP", "EMAIL", "SMS", "WHATSAPP"]).optional(),
  recipientType: z.string().trim().min(1).max(100).optional(),
  executionWindowStartMinute: minute.optional(),
  executionWindowEndMinute: minute.optional(),
  timezone: z.string().trim().min(1).max(100).default("UTC"),
  maxExecutions: z.number().int().min(1).max(10_000).optional(),
  frequencyWindowMinutes: z.number().int().min(1).max(525_600).optional(),
  escalationAfterMinutes: z.number().int().min(1).max(525_600).optional(),
  minSeverity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  maxSeverity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  monetaryThresholdMinor: z.string().regex(/^(0|[1-9]\d*)$/).optional(),
}).strict().superRefine((value, context) => {
  if ((value.executionWindowStartMinute === undefined) !== (value.executionWindowEndMinute === undefined)) {
    context.addIssue({ code: "custom", path: ["executionWindowEndMinute"], message: "Execution window start and end must be configured together." });
  }
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  if (value.minSeverity && value.maxSeverity && rank[value.minSeverity] > rank[value.maxSeverity]) {
    context.addIssue({ code: "custom", path: ["maxSeverity"], message: "Maximum severity cannot be below minimum severity." });
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(new Date());
  } catch {
    context.addIssue({ code: "custom", path: ["timezone"], message: "Timezone must be a valid IANA timezone." });
  }
});

export const pauseAutomationSchema = z.object({
  paused: z.boolean(),
  reason: z.string().trim().min(3).max(1_000),
}).strict();

export const activityQuerySchema = z.object({
  status: z.enum(["RECORDED", "PENDING", "COMPLETED", "FAILED", "BLOCKED"]).optional(),
  type: z.enum(["DETECTION", "RECOMMENDATION", "PROPOSAL", "AUTO_EXECUTION", "ESCALATION", "POLICY_BLOCKED", "FAILURE"]).optional(),
  take: z.coerce.number().int().min(1).max(200).default(100),
});
