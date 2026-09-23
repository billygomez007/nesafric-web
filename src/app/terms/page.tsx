import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { BRAND } from "@/platform/brand";

export default function TermsPage() {
  return (
    <>
      <SiteNav />
      <main className="bg-warm-white px-5 py-16 sm:px-8 sm:py-24">
        <article className="mx-auto max-w-4xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">LEGAL</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-forest-deep sm:text-5xl">Terms & Conditions</h1>
          <p className="mt-5 text-sm text-muted">Last updated: 23 September 2026</p>

          <div className="mt-10 space-y-9 text-[15px] leading-7 text-muted">
            <section><h2 className="text-xl font-semibold text-forest-deep">1. Using NesAfric</h2><p className="mt-3">These terms govern access to and use of {BRAND.name} websites, applications, property-management tools, marketplace features and related services. By using the platform, you agree to these terms.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">2. Accounts and organisations</h2><p className="mt-3">You are responsible for information submitted through your account, keeping credentials secure and ensuring that users you invite have appropriate authority to act for your organisation.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">3. Platform use</h2><p className="mt-3">You must not misuse the platform, interfere with its operation, attempt unauthorised access, upload unlawful content, impersonate others or use NesAfric to facilitate fraudulent or prohibited activity.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">4. Marketplace relationships</h2><p className="mt-3">Unless expressly stated otherwise, NesAfric provides technology that helps users discover, communicate and transact. Property owners, professionals, tenants and other marketplace participants remain responsible for their own listings, representations, agreements and services.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">5. Payments and subscriptions</h2><p className="mt-3">Paid features may be subject to plan limits, billing terms and third-party payment-provider requirements presented at checkout or within your account. Fees already incurred remain payable unless applicable terms or law provide otherwise.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">6. Availability and changes</h2><p className="mt-3">We may improve, modify or discontinue features as the platform evolves. We aim to provide reliable service but cannot guarantee uninterrupted or error-free availability.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">7. Contact</h2><p className="mt-3">Questions about these terms can be sent to <a className="font-semibold text-forest hover:text-emerald" href={`mailto:${BRAND.contact.info}`}>{BRAND.contact.info}</a>.</p></section>
          </div>

          <div className="mt-12 border-t border-hairline pt-6 text-sm text-muted">
            See also our <Link className="font-semibold text-forest" href="/privacy">Privacy Policy</Link> and <Link className="font-semibold text-forest" href="/cookies">Cookie Policy</Link>.
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
