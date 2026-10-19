-- One attachment per external media item (e.g. a WhatsApp photo) per request. Existing rows have
-- no source and are unaffected (NULLs never conflict in a unique index).
ALTER TABLE "MaintenanceAttachment" ADD COLUMN "sourceMediaId" TEXT;
ALTER TABLE "MaintenanceAttachment" ADD CONSTRAINT "MaintenanceAttachment_sourceMediaId_length_check"
  CHECK ("sourceMediaId" IS NULL OR char_length("sourceMediaId") <= 200);
CREATE UNIQUE INDEX "MaintenanceAttachment_maintenanceRequestId_sourceMediaId_key" ON "MaintenanceAttachment"("maintenanceRequestId", "sourceMediaId");
