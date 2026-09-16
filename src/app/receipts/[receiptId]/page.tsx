import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ReceiptDetail } from "@/components/receipt-detail";

export default async function ReceiptPage({ params }: { params: Promise<{ receiptId: string }> }) {
  return <AppShell actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/payments">Back to payments</Link>} description="A clear record of the payment, allocation, and issued receipt." eyebrow="RECEIPT" title="Payment receipt"><ReceiptDetail receiptId={(await params).receiptId} /></AppShell>;
}
