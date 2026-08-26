import Link from "next/link";
import { ViewingCrmDetail } from "@/components/viewing-crm-detail";

export default async function ViewingPage({ params }: { params: Promise<{ viewingId: string }> }) {
  const { viewingId } = await params;
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12"><Link className="mb-6 inline-block text-sm font-semibold text-emerald-700" href="/leasing">← Leasing CRM</Link><ViewingCrmDetail viewingId={viewingId} /></main>;
}
