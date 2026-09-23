import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PaymentDetail } from "@/components/payment-detail";

export default async function PaymentDetailPage({ params }: { params: Promise<{ paymentId: string }> }) {
  return <AppShell actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/payments">Back to payments</Link>} description="Review the transaction, allocations, receipt, and reconciliation trail." eyebrow="PAYMENT" title="Payment detail"><PaymentDetail paymentId={(await params).paymentId} /></AppShell>;
}
