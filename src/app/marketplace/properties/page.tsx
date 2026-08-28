import Link from "next/link";
import { PropertyMarketplaceSearch } from "@/components/property-marketplace-search";
import { MarketplaceCarousel } from "@/components/marketplace-carousel";
import { BrandLogo } from "@/components/brand-logo";

export default function PropertyMarketplacePage() {
  return <main className="min-h-screen bg-surface"><header className="border-b bg-navy px-4 py-12 text-white sm:px-6"><div className="mx-auto max-w-7xl"><nav className="flex flex-wrap items-center justify-between gap-4"><Link href="/"><BrandLogo height={24} /></Link><div className="flex gap-4 text-sm"><Link href="/marketplace/professionals">Find a professional</Link><Link href="/marketplace">Find artisans</Link><Link href="/listings">Manage listings</Link><Link href="/dashboard">Dashboard</Link></div></nav><div className="mt-12 grid gap-10 lg:grid-cols-[0.82fr_1fr] lg:items-center"><div><p className="text-sm font-semibold tracking-wider text-brand">PROPERTY MARKETPLACE</p><h1 className="mt-2 max-w-3xl text-4xl font-semibold sm:text-5xl">Find your next property.</h1><p className="mt-4 max-w-2xl text-slate-300">Verified, currently available properties and units linked to managed assets.</p></div><MarketplaceCarousel placement="MARKETPLACE_PRIMARY" variant="hero" /></div></div></header><div className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><PropertyMarketplaceSearch /></div></main>;
}
