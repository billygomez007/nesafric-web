import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ManualPaymentForm } from "@/components/manual-payment-form";

export default function NewPaymentPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/payments">
          Payment history
        </Link>
      }
      description="Record cash, direct bank transfer, or manual Mobile Money received outside NesAfric."
      eyebrow="OFFLINE COLLECTION"
      size="medium"
      title="Record manual payment"
    >
      <ManualPaymentForm />
    </AppShell>
  );
}
