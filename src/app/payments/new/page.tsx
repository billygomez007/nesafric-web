import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ManualPaymentForm } from "@/components/manual-payment-form";

export default function NewPaymentPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href="/payments">
          Payment history
        </Link>
      }
      description="Record cash, direct bank transfer, or manual Mobile Money received outside UmoAfric."
      eyebrow="OFFLINE COLLECTION"
      size="medium"
      title="Record manual payment"
    >
      <ManualPaymentForm />
    </AppShell>
  );
}
