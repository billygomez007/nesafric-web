import Link from "next/link";
import { ListingEditor } from "@/components/listing-editor";

export default function NewListingPage() {
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8"><p className="text-sm font-semibold text-emerald-700">NEW LISTING</p><h1 className="mt-1 text-3xl font-semibold">Create property marketplace listing</h1><p className="mt-2 text-slate-600">Create a public marketing record linked to a managed property or unit.</p><Link className="mt-3 inline-block text-sm font-semibold text-emerald-700" href="/listings">← Listings dashboard</Link></header><ListingEditor /></main>;
}
