import { ReceiptDetail } from "@/components/receipt-detail";

export default async function ReceiptPage({ params }: { params: Promise<{ receiptId: string }> }) {
  return <main className="w-full px-4 py-8 sm:px-6 sm:py-12"><ReceiptDetail receiptId={(await params).receiptId} /></main>;
}
