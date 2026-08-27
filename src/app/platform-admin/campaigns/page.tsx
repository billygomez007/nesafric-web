"use client";

import { PlatformAdminShell } from "@/components/platform-admin/shell";
import { CampaignsAdminContent } from "@/components/platform-admin/campaigns-content";

export default function PlatformAdminCampaignsPage() {
  return <PlatformAdminShell><CampaignsAdminContent /></PlatformAdminShell>;
}
