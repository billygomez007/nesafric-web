import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { z } from "zod";

const documentTemplateSchema = z.object({
  documentType: z.enum(["RECEIPT", "TENANT_STATEMENT", "MOVE_OUT_STATEMENT", "LEASE_AGREEMENT"]),
  name: z.string().trim().min(1).max(200),
  bodyTemplate: z.string().trim().min(1).max(50_000),
  isActive: z.boolean().default(true),
}).strict();

/**
 * Organisation-configurable legal template (item 3: "Lease templates configurable/readiness; no
 * universal Ghana legal clauses"). PropertyOS never ships or infers jurisdiction-specific legal
 * language — an organisation supplies its own lawyer-approved template text with `{{placeholder}}`
 * tokens; generation only ever substitutes real record data into placeholders the org itself wrote.
 */
export async function upsertDocumentTemplate(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.documentTemplateManage);
  const data = documentTemplateSchema.parse(input);
  return db.documentTemplate.upsert({
    where: { organisationId_documentType: { organisationId, documentType: data.documentType } },
    update: { name: data.name, bodyTemplate: data.bodyTemplate, isActive: data.isActive },
    create: { organisationId, documentType: data.documentType, name: data.name, bodyTemplate: data.bodyTemplate, isActive: data.isActive, createdByUserId: userId },
  });
}

export async function listDocumentTemplates(userId: string, organisationId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.documentTemplateManage);
  return db.documentTemplate.findMany({ where: { organisationId }, orderBy: { documentType: "asc" } });
}

export async function getActiveDocumentTemplate(organisationId: string, documentType: "RECEIPT" | "TENANT_STATEMENT" | "MOVE_OUT_STATEMENT" | "LEASE_AGREEMENT") {
  return db.documentTemplate.findFirst({ where: { organisationId, documentType, isActive: true } });
}

/** Substitutes `{{token}}` placeholders with the supplied real values; unknown tokens are left as an explicit marker rather than silently guessed. */
export function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, token: string) => (token in values ? values[token] : `[[missing:${token}]]`));
}
