import { LeaseDetail } from "@/components/lease-detail";

export default async function LeaseDetailPage({ params }: { params: Promise<{ leaseId: string }> }) {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12"><LeaseDetail leaseId={(await params).leaseId} /></main>;
}
