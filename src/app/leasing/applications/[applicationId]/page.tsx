import Link from "next/link";
import { RentalApplicationDetail } from "@/components/rental-application-detail";

export default async function ApplicationPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12"><Link className="mb-6 inline-block text-sm font-semibold text-emerald-700" href="/leasing">← Leasing CRM</Link><RentalApplicationDetail applicationId={applicationId} /></main>;
}
