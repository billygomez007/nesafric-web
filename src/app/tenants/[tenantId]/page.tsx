import { TenantDetail } from "@/components/tenant-detail";

export default async function TenantDetailPage({ params }: { params: Promise<{ tenantId: string }> }) {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12"><TenantDetail tenantId={(await params).tenantId} /></main>;
}
