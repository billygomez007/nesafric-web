INSERT INTO "Permission" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'payment.read', 'View payments, receipts, and rent collection metrics'),
  (gen_random_uuid(), 'payment.record', 'Create payment requests and record payments'),
  (gen_random_uuid(), 'payment.reverse', 'Reverse confirmed payments'),
  (gen_random_uuid(), 'deposit.read', 'View security deposits'),
  (gen_random_uuid(), 'deposit.record', 'Record security deposits'),
  (gen_random_uuid(), 'ledger.read', 'View the immutable property financial ledger')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
CROSS JOIN "Permission" permission
WHERE
  (
    role."key" IN ('organisation_owner', 'administrator', 'property_manager')
    AND permission."key" IN ('payment.read', 'payment.record', 'payment.reverse', 'deposit.read', 'deposit.record', 'ledger.read')
  )
  OR
  (
    role."key" = 'viewer'
    AND permission."key" IN ('payment.read', 'deposit.read', 'ledger.read')
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
