"use client";

import { PlatformAdminShell } from "@/components/platform-admin/shell";
import { ServiceProvidersAdminContent } from "@/components/platform-admin/service-providers-content";

export default function PlatformAdminServiceProvidersPage() {
  return <PlatformAdminShell><ServiceProvidersAdminContent /></PlatformAdminShell>;
}
