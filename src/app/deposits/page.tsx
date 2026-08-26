import Link from "next/link";
import { DepositManager } from "@/components/deposit-manager";

export default function DepositsPage() {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row"><div><p className="text-sm font-semibold text-emerald-700">DEPOSIT FOUNDATION</p><h1 className="mt-1 text-3xl font-semibold">Security deposits</h1><p className="mt-2 text-slate-600">Track held caution deposits separately from rent revenue.</p></div><Link className="self-start rounded-lg border px-4 py-2 text-sm font-semibold" href="/payments">Back to payments</Link></header><DepositManager /></main>;
}
