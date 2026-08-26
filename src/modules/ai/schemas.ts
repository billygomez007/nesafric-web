import { z } from "zod";

export const createAISessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const askAISchema = z.object({
  message: z.string().trim().min(1).max(4_000),
});

export const proposalSchema = z.object({
  sessionId: z.string().uuid(),
  toolKey: z.string().trim().min(1).max(100),
  arguments: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(3).max(1_000),
  explanation: z.string().trim().min(3).max(1_000),
  expectedResult: z.string().trim().min(3).max(1_000).optional(),
  affectedEntities: z.array(z.object({
    type: z.enum(["property", "unit", "tenant", "lease", "maintenance_request", "work_order", "provider", "listing", "lead", "viewing", "notification", "background_job"]),
    id: z.string().uuid(),
  }).strict()).max(20).optional(),
});

export const proposalDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().min(3).max(1_000),
});
