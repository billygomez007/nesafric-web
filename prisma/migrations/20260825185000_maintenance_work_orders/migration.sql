CREATE TYPE "MaintenancePriority" AS ENUM ('EMERGENCY', 'URGENT', 'NORMAL', 'LOW');
CREATE TYPE "MaintenanceStatus" AS ENUM ('REPORTED', 'TRIAGED', 'AWAITING_APPROVAL', 'APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'REJECTED', 'CANCELLED');
CREATE TYPE "MaintenanceHistoryType" AS ENUM ('STATUS', 'NOTE', 'APPROVAL', 'ASSIGNMENT', 'ESTIMATE', 'ACTUAL_COST');
CREATE TYPE "MaintenanceApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

ALTER TABLE "TenantOrganisation" ADD COLUMN "userId" UUID;
CREATE UNIQUE INDEX "TenantOrganisation_organisationId_userId_key" ON "TenantOrganisation"("organisationId", "userId");
ALTER TABLE "TenantOrganisation"
  ADD CONSTRAINT "TenantOrganisation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MaintenanceRequest" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "unitId" UUID,
  "tenantOrganisationId" UUID,
  "leaseId" UUID,
  "reportedByUserId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "priority" "MaintenancePriority" NOT NULL DEFAULT 'NORMAL',
  "status" "MaintenanceStatus" NOT NULL DEFAULT 'REPORTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "MaintenanceRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceAttachment" (
  "id" UUID NOT NULL,
  "maintenanceRequestId" UUID NOT NULL,
  "fileKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT,
  "sizeBytes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaintenanceAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceHistory" (
  "id" UUID NOT NULL,
  "maintenanceRequestId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "type" "MaintenanceHistoryType" NOT NULL,
  "fromStatus" "MaintenanceStatus",
  "toStatus" "MaintenanceStatus",
  "note" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaintenanceHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceApproval" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "maintenanceRequestId" UUID NOT NULL,
  "requestedByUserId" UUID NOT NULL,
  "decidedByUserId" UUID,
  "status" "MaintenanceApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAmountMinor" DECIMAL(19,0) NOT NULL,
  "approvedAmountMinor" DECIMAL(19,0),
  "currencyCode" CHAR(3) NOT NULL,
  "requestReason" TEXT,
  "decisionReason" TEXT,
  "thresholdReference" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "MaintenanceApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkOrder" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "maintenanceRequestId" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "unitId" UUID,
  "createdByUserId" UUID NOT NULL,
  "assigneeMemberId" UUID,
  "assigneeUserId" UUID,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
  "dueAt" TIMESTAMP(3),
  "estimateAmountMinor" DECIMAL(19,0),
  "actualCostAmountMinor" DECIMAL(19,0),
  "currencyCode" CHAR(3) NOT NULL,
  "externalServiceProviderRef" TEXT,
  "quotationReference" TEXT,
  "externalAssignmentRef" TEXT,
  "ratingReference" TEXT,
  "paymentReference" TEXT,
  "financialLedgerReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "assignedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkOrderHistory" (
  "id" UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "status" "WorkOrderStatus" NOT NULL,
  "estimateAmountMinor" DECIMAL(19,0),
  "actualCostAmountMinor" DECIMAL(19,0),
  "currencyCode" CHAR(3) NOT NULL,
  "assigneeMemberId" UUID,
  "assigneeUserId" UUID,
  "note" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaintenanceRequest_organisationId_status_createdAt_idx" ON "MaintenanceRequest"("organisationId", "status", "createdAt");
CREATE INDEX "MaintenanceRequest_propertyId_createdAt_idx" ON "MaintenanceRequest"("propertyId", "createdAt");
CREATE INDEX "MaintenanceRequest_tenantOrganisationId_createdAt_idx" ON "MaintenanceRequest"("tenantOrganisationId", "createdAt");
CREATE INDEX "MaintenanceRequest_unitId_createdAt_idx" ON "MaintenanceRequest"("unitId", "createdAt");
CREATE INDEX "MaintenanceRequest_leaseId_idx" ON "MaintenanceRequest"("leaseId");
CREATE UNIQUE INDEX "MaintenanceAttachment_maintenanceRequestId_fileKey_key" ON "MaintenanceAttachment"("maintenanceRequestId", "fileKey");
CREATE INDEX "MaintenanceHistory_maintenanceRequestId_createdAt_idx" ON "MaintenanceHistory"("maintenanceRequestId", "createdAt");
CREATE INDEX "MaintenanceApproval_organisationId_status_requestedAt_idx" ON "MaintenanceApproval"("organisationId", "status", "requestedAt");
CREATE INDEX "MaintenanceApproval_maintenanceRequestId_requestedAt_idx" ON "MaintenanceApproval"("maintenanceRequestId", "requestedAt");
CREATE INDEX "WorkOrder_organisationId_status_createdAt_idx" ON "WorkOrder"("organisationId", "status", "createdAt");
CREATE INDEX "WorkOrder_maintenanceRequestId_createdAt_idx" ON "WorkOrder"("maintenanceRequestId", "createdAt");
CREATE INDEX "WorkOrder_assigneeMemberId_status_idx" ON "WorkOrder"("assigneeMemberId", "status");
CREATE INDEX "WorkOrderHistory_workOrderId_createdAt_idx" ON "WorkOrderHistory"("workOrderId", "createdAt");

ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_tenantOrganisationId_fkey" FOREIGN KEY ("tenantOrganisationId") REFERENCES "TenantOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceAttachment" ADD CONSTRAINT "MaintenanceAttachment_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceHistory" ADD CONSTRAINT "MaintenanceHistory_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceHistory" ADD CONSTRAINT "MaintenanceHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceApproval" ADD CONSTRAINT "MaintenanceApproval_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceApproval" ADD CONSTRAINT "MaintenanceApproval_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceApproval" ADD CONSTRAINT "MaintenanceApproval_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceApproval" ADD CONSTRAINT "MaintenanceApproval_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_assigneeMemberId_fkey" FOREIGN KEY ("assigneeMemberId") REFERENCES "OrganisationMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrderHistory" ADD CONSTRAINT "WorkOrderHistory_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrderHistory" ADD CONSTRAINT "WorkOrderHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'maintenance.read', 'View maintenance requests, work orders, and metrics'),
  (gen_random_uuid(), 'maintenance.create', 'Create maintenance requests'),
  (gen_random_uuid(), 'maintenance.manage', 'Triage and manage maintenance request lifecycles'),
  (gen_random_uuid(), 'maintenance.approve', 'Approve or reject maintenance estimates'),
  (gen_random_uuid(), 'maintenance.assign', 'Create and assign internal work orders'),
  (gen_random_uuid(), 'maintenance.cost', 'Record work order estimates and actual costs')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
CROSS JOIN "Permission" permission
WHERE
  (
    role."key" IN ('organisation_owner', 'administrator', 'property_manager')
    AND permission."key" IN ('maintenance.read', 'maintenance.create', 'maintenance.manage', 'maintenance.approve', 'maintenance.assign', 'maintenance.cost')
  )
  OR
  (
    role."key" = 'viewer'
    AND permission."key" = 'maintenance.read'
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
