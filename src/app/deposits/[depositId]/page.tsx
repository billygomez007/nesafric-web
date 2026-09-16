import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DepositDetail } from "@/components/deposit-detail";

export default async function DepositDetailPage({ params }: { params: Promise<{ depositId: string }> }) {
  return <AppShell actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/deposits">Back to deposits</Link>} description="Review held funds, deductions, refunds, and the immutable deposit ledger." eyebrow="SECURITY DEPOSIT" title="Deposit detail"><DepositDetail depositId={(await params).depositId} /></AppShell>;
}
