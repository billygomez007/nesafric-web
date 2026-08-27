import { AppShell } from "@/components/app-shell";
import { PaymentList } from "@/components/payment-list";
import { ReconciliationDashboard } from "@/components/reconciliation-dashboard";

export default function PaymentsPage() {
  return (
    <AppShell description="Track rent collected, outstanding obligations, receipts, and reversals." eyebrow="RENT COLLECTION" title="Payments">
      <div className="grid gap-6">
        <PaymentList />
        <ReconciliationDashboard />
      </div>
    </AppShell>
  );
}
