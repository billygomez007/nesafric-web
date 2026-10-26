# Rollback: 20261026120000_whatsapp_admin_pin

Additive columns only. Dropping them switches WhatsApp admin off for everyone (no PIN, no unlock);
the web admin is unaffected.

```sql
ALTER TABLE "PlatformPrincipal" DROP COLUMN "whatsappPinHash", DROP COLUMN "whatsappPinFailures", DROP COLUMN "whatsappPinLockedUntil", DROP COLUMN "whatsappUnlockedUntil";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261026120000_whatsapp_admin_pin';
```

Roll the code back first.
