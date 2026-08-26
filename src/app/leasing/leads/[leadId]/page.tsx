import Link from "next/link";
import { LeadCrmDetail } from "@/components/lead-crm-detail";

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12"><Link className="mb-6 inline-block text-sm font-semibold text-emerald-700" href="/leasing">← Leasing CRM</Link><LeadCrmDetail leadId={leadId} /></main>;
}
