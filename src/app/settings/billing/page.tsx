import Link from "next/link";
import { BillingSettings } from "@/components/billing-settings";

export default function BillingSettingsPage() {
  return <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
    <div className="mb-6"><Link className="text-sm font-semibold text-emerald-700" href="/dashboard">← Dashboard</Link></div>
    <BillingSettings />
  </main>;
}
