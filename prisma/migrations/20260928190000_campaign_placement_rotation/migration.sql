-- Additive only: placement-wide carousel rotation (5, 8 or 10 seconds). No row means 5 seconds.
CREATE TABLE "CampaignPlacementSetting" (
    "placement" "CampaignPlacement" NOT NULL,
    "rotationSeconds" INTEGER NOT NULL DEFAULT 5,
    "updatedByPlatformPrincipalId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignPlacementSetting_pkey" PRIMARY KEY ("placement"),
    CONSTRAINT "CampaignPlacementSetting_rotationSeconds_check" CHECK ("rotationSeconds" IN (5, 8, 10))
);

ALTER TABLE "CampaignPlacementSetting" ADD CONSTRAINT "CampaignPlacementSetting_updatedByPlatformPrincipalId_fkey" FOREIGN KEY ("updatedByPlatformPrincipalId") REFERENCES "PlatformPrincipal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
