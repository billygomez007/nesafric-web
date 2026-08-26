-- AlterTable
ALTER TABLE "AIActionProposal"
ADD COLUMN "affectedEntities" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "expectedResult" TEXT NOT NULL DEFAULT 'The approved action executes through its existing PropertyOS domain service.';

ALTER TABLE "AIActionProposal"
ALTER COLUMN "affectedEntities" DROP DEFAULT,
ALTER COLUMN "expectedResult" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AIMessage" ADD COLUMN     "estimatedCostNano" DECIMAL(19,0),
ADD COLUMN     "latencyMs" INTEGER,
ADD COLUMN     "modelKey" TEXT,
ADD COLUMN     "providerAttempts" INTEGER,
ADD COLUMN     "providerKey" TEXT;

INSERT INTO "Permission" ("id", "key", "description")
VALUES (gen_random_uuid(), 'job.retry', 'Retry eligible failed background jobs')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role CROSS JOIN "Permission" permission
WHERE role."key" IN ('organisation_owner', 'administrator', 'property_manager')
  AND permission."key" = 'job.retry'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
