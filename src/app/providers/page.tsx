import Link from "next/link";
import { ProviderDirectory } from "@/components/provider-directory";
import { ServiceCategoryManager } from "@/components/service-category-manager";

export default function ProvidersPage() {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row"><div><p className="text-sm font-semibold text-emerald-700">SERVICE NETWORK</p><h1 className="mt-1 text-3xl font-semibold">Artisans and service providers</h1><p className="mt-2 text-slate-600">Manage verified provider relationships without exposing a public marketplace.</p></div><Link className="self-start rounded-lg border px-4 py-2 text-sm font-semibold" href="/dashboard">Back to dashboard</Link></header><ProviderDirectory /><ServiceCategoryManager /></main>;
}
