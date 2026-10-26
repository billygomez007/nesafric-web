# Rollback: 20261026090000_whatsapp_viewing_proposals

Additive only: a new table and two enums. Nothing else references them, so dropping them loses
only the WhatsApp viewing negotiation history (viewing requests and their statuses are untouched).

```sql
DROP TABLE "ViewingProposal";
DROP TYPE "ViewingProposalStatus";
DROP TYPE "ViewingProposalParty";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261026090000_whatsapp_viewing_proposals';
```

Roll the code back first (the previous image does not use the table).
