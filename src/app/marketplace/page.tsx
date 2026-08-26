import Link from "next/link";
import { MarketplaceSearch } from "@/components/marketplace-search";

export default function MarketplacePage() {
  return <main className="min-h-screen bg-slate-50"><header className="border-b bg-slate-950 px-4 py-12 text-white sm:px-6"><div className="mx-auto max-w-7xl"><nav className="flex justify-between gap-4"><Link className="font-semibold" href="/">PropertyOS</Link>  <div className="flex gap-4 text-sm"><Link href="/marketplace/properties">Find properties</Link><Link href="/marketplace/requests">Request history</Link><Link href="/dashboard">Dashboard</Link></div></nav><p className="mt-12 text-sm font-semibold tracking-wider text-emerald-300">TRUSTED SERVICE NETWORK</p><h1 className="mt-2 max-w-3xl text-4xl font-semibold sm:text-5xl">Find verified artisans and service providers.</h1><p className="mt-4 max-w-2xl text-slate-300">Search by skill, service area, availability, and verified platform performance.</p></div></header><div className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><MarketplaceSearch /></div></main>;
}
