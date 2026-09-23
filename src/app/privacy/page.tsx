import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { BRAND } from "@/platform/brand";

export default function PrivacyPage() {
  return (
    <>
      <SiteNav />
      <main className="bg-warm-white px-5 py-16 sm:px-8 sm:py-24">
        <article className="mx-auto max-w-4xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">LEGAL</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-forest-deep sm:text-5xl">Privacy Policy</h1>
          <p className="mt-5 text-sm text-muted">Last updated: 23 September 2026</p>

          <div className="mt-10 space-y-9 text-[15px] leading-7 text-muted">
            <section><h2 className="text-xl font-semibold text-forest-deep">1. About this policy</h2><p className="mt-3">This policy explains how {BRAND.name} handles personal information when you use our websites, applications, marketplace and related services.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">2. Information we collect</h2><p className="mt-3">Depending on how you use the platform, we may collect account and contact details, organisation information, property and tenancy records, payment and transaction information, communications, device and usage data, and information you choose to upload.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">3. How we use information</h2><p className="mt-3">We use information to provide and secure the platform, operate accounts and workspaces, process requested transactions, support users, improve services, communicate service updates, prevent misuse and meet applicable legal obligations.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">4. Sharing and service providers</h2><p className="mt-3">We may share information with service providers that help us operate the platform, with organisations you choose to interact with through NesAfric, and where disclosure is required by law. We do not sell personal information to advertisers.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">5. Data retention and security</h2><p className="mt-3">We retain information for as long as reasonably necessary for the purposes described in this policy and apply technical and organisational safeguards appropriate to the nature of the information.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">6. Your choices and rights</h2><p className="mt-3">You may request access, correction or deletion of personal information where applicable. Some information may need to be retained for security, transaction records or legal obligations.</p></section>
            <section><h2 className="text-xl font-semibold text-forest-deep">7. Contact us</h2><p className="mt-3">For privacy questions, contact <a className="font-semibold text-forest hover:text-emerald" href={`mailto:${BRAND.contact.info}`}>{BRAND.contact.info}</a>.</p></section>
          </div>

          <div className="mt-12 border-t border-hairline pt-6 text-sm text-muted">
            Also see our <Link className="font-semibold text-forest" href="/terms">Terms & Conditions</Link> and <Link className="font-semibold text-forest" href="/cookies">Cookie Policy</Link>.
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
