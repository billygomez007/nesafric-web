import Link from "next/link";
import { PropertyMarketplaceSearch } from "@/components/property-marketplace-search";
import { MarketplaceBanner } from "@/components/marketplace-banner";
import { BrandLogo } from "@/components/brand-logo";
import { ProductMockup } from "@/components/marketing/product-mockup";

export default function PropertyMarketplacePage() {
  return <main className="min-h-screen bg-slate-50"><header className="border-b bg-emerald-950 px-4 py-12 text-white sm:px-6"><div className="mx-auto max-w-7xl"><nav className="flex flex-wrap items-center justify-between gap-4"><Link href="/"><BrandLogo height={24} /></Link><div className="flex gap-4 text-sm"><Link href="/marketplace/professionals">Find a professional</Link><Link href="/marketplace">Find artisans</Link><Link href="/listings">Manage listings</Link><Link href="/dashboard">Dashboard</Link></div></nav><div className="mt-12 grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:items-center"><div><p className="text-sm font-semibold tracking-wider text-emerald-300">PROPERTY MARKETPLACE</p><h1 className="mt-2 max-w-3xl text-4xl font-semibold sm:text-5xl">Find your next property.</h1><p className="mt-4 max-w-2xl text-emerald-100">Verified, currently available properties and units linked to managed assets.</p></div><div className="hidden lg:block"><ProductMockup alt="Umo Afric Marketplace showing premium property listings, developments and an interactive map alongside the mobile marketplace experience" maxWidthClassName="max-w-none" src="/marketing/mockups/marketplace-overview.png" /></div></div></div></header><div className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><div className="mb-6"><MarketplaceBanner placement="MARKETPLACE_PRIMARY" /></div><PropertyMarketplaceSearch /></div></main>;
}
