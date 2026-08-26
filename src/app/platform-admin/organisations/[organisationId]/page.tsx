import { PlatformAdminShell } from "@/components/platform-admin/shell";
import { PlatformAdminOrganisationDetail } from "@/components/platform-admin/organisation-detail";

export default async function PlatformAdminOrganisationDetailPage({ params }: { params: Promise<{ organisationId: string }> }) {
  const { organisationId } = await params;
  return <PlatformAdminShell><PlatformAdminOrganisationDetail organisationId={organisationId} /></PlatformAdminShell>;
}
