import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { BRAND } from "@/platform/brand";

export default function CookiesPage() {
  return (
    <>
      <SiteNav />
      <main className="bg-warm-white px-5 py-16 sm:px-8 sm:py-24">
        <article className="mx-auto max-w-4xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">LEGAL</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-forest-deep sm:text-5xl">Cookie Policy</h1>
          <p className="mt-5 text-sm text-muted">Last updated: 23 September 2026</p>

          <div className="mt-10 space-y-9 text-[15px] leading-7 text-muted">
            <section><h2 className="text-xl font-semibold text-forest-deep">1. What cookies are</h2><p className="mt-3">Cookies and similar technologies are small pieces of data used by websites and applications to remember settings, maintain sessions and understand how services are used.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">2. How NesAfric may use them</h2><p className="mt-3">We may use strictly necessary technologies for authentication, security and core functionality, and may use preference or analytics technologies where enabled.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">3. Managing cookies</h2><p className="mt-3">You can control cookies through your browser settings. Blocking necessary cookies may prevent sign-in or other parts of the platform from working correctly.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">4. Changes</h2><p className="mt-3">We may update this policy as our technology and service providers change.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">5. Contact</h2><p className="mt-3">Questions can be sent to <a className="font-semibold text-forest hover:text-emerald" href={`mailto:${BRAND.contact.info}`}>{BRAND.contact.info}</a>.</p></section>
          </div>

          <div className="mt-12 border-t border-hairline pt-6 text-sm text-muted">
            Read our <Link className="font-semibold text-forest" href="/privacy">Privacy Policy</Link> and <Link className="font-semibold text-forest" href="/terms">Terms & Conditions</Link>.
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
