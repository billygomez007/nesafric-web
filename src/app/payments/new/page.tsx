import Link from "next/link";
import { ManualPaymentForm } from "@/components/manual-payment-form";

export default function NewPaymentPage() {
  return <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8"><p className="text-sm font-semibold text-emerald-700">OFFLINE COLLECTION</p><h1 className="mt-1 text-3xl font-semibold">Record manual payment</h1><p className="mt-2 text-slate-600">Record cash, direct bank transfer, or manual Mobile Money received outside PropertyOS.</p><Link className="mt-3 inline-block text-sm font-semibold text-emerald-700" href="/payments">← Payment history</Link></header><ManualPaymentForm /></main>;
}
