import { z } from "zod";

export const createFeatureFlagSchema = z.object({
  key: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  isEnabled: z.boolean().optional().default(false),
  rolloutPercentage: z.number().int().min(0).max(100).optional().default(100),
  emergencyDisabled: z.boolean().optional().default(false),
}).strict();

export const updateFeatureFlagSchema = z.object({
  description: z.string().trim().min(1).max(500).optional(),
  isEnabled: z.boolean().optional(),
  rolloutPercentage: z.number().int().min(0).max(100).optional(),
  emergencyDisabled: z.boolean().optional(),
}).strict();

export const setFlagOverrideSchema = z.object({ enabled: z.boolean() }).strict();

export const organisationListQuerySchema = z.object({
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD", "SUSPENDED", "CANCELLED"]).optional(),
  search: z.string().trim().min(1).max(160).optional(),
  take: z.number().int().min(1).max(100).optional().default(50),
}).strict();

export const platformAuditQuerySchema = z.object({
  organisationId: z.string().uuid().optional(),
  take: z.number().int().min(1).max(200).optional().default(100),
}).strict();
