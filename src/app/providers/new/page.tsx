import Link from "next/link";
import { ProviderForm } from "@/components/provider-form";

export default function NewProviderPage() {
  return <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8"><p className="text-sm font-semibold text-emerald-700">REGISTER PROVIDER</p><h1 className="mt-1 text-3xl font-semibold">Create a provider profile</h1><p className="mt-2 text-slate-600">Profiles reuse existing user or organisation identity and can join multiple private directories.</p><Link className="mt-3 inline-block text-sm font-semibold text-emerald-700" href="/providers">← Provider directory</Link></header><ProviderForm /></main>;
}
