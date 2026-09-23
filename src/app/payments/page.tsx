import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PaymentList } from "@/components/payment-list";
import { ReconciliationDashboard } from "@/components/reconciliation-dashboard";

export default function PaymentsPage() {
  return (
    <AppShell actions={<Link className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-forest-light" href="/payments/new">Record payment</Link>} description="Track rent collected, outstanding obligations, receipts, and reversals." eyebrow="RENT COLLECTION" title="Payments">
      <div className="grid gap-6">
        <PaymentList />
        <ReconciliationDashboard />
      </div>
    </AppShell>
  );
}
