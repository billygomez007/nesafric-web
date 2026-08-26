import { DepositDetail } from "@/components/deposit-detail";

export default async function DepositDetailPage({ params }: { params: Promise<{ depositId: string }> }) {
  return <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12"><DepositDetail depositId={(await params).depositId} /></main>;
}
