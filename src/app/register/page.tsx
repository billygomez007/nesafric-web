import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { BrandLogo } from "@/components/brand-logo";

export default function RegisterPage() {
  return <main className="min-h-screen bg-warm-white lg:grid lg:grid-cols-[0.9fr_1.1fr]">
    <section className="hidden bg-forest-deep p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14"><Link href="/"><BrandLogo height={31} variant="light" /></Link><div className="max-w-md"><p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-soft">REAL ESTATE OS FOR AFRICA</p><h1 className="mt-5 text-4xl font-semibold leading-tight xl:text-5xl">One identity for every side of real estate.</h1><p className="mt-5 text-base leading-7 text-white/70">Start with property operations, marketplace work or property services, then add another workspace when you need it.</p></div><p className="text-xs text-white/45">© NesAfric</p></section>
    <section className="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10"><div className="w-full max-w-md"><Link className="inline-flex lg:hidden" href="/"><BrandLogo height={27} variant="light" /></Link><div className="mt-10 rounded-3xl border border-hairline bg-white p-7 shadow-card sm:p-9 lg:mt-0"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">GET STARTED</p><h2 className="mt-3 text-3xl font-semibold tracking-tight text-forest">Create your NesAfric account</h2><p className="mt-2 text-sm leading-6 text-muted">One secure identity for properties, marketplace work and service profiles.</p><AuthForm mode="register" /><p className="mt-6 text-center text-sm text-muted">Already registered? <Link className="font-semibold text-teal hover:text-emerald" href="/login">Sign in</Link></p></div></div></section>
  </main>;
}
