import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { BRAND } from "@/platform/brand";

const sections = [
  ["1. Agreement to these terms", <>These Terms & Conditions govern your access to and use of {BRAND.name} websites, applications, dashboards, marketplace, communications and related services. By creating an account, accessing a workspace or using the platform, you agree to these terms and any additional terms presented for a specific service or paid plan.</>],
  ["2. Eligibility and authority", <>You must have legal capacity to enter into these terms. If you use NesAfric for a company, property business, agency, professional practice or other organisation, you represent that you are authorised to act for that organisation and to bind it to these terms.</>],
  ["3. Accounts and security", <>You are responsible for accurate account information, maintaining the confidentiality of credentials, controlling access granted to team members and promptly notifying us of suspected unauthorised use. Actions taken through your account may be treated as authorised until we are notified otherwise.</>],
  ["4. Organisations, roles and permissions", <>Organisation owners and administrators are responsible for assigning appropriate roles and permissions. NesAfric may provide tools for collaboration, but the organisation remains responsible for deciding who may view, create, approve or change its records and transactions.</>],
  ["5. Property, tenant and lease information", <>You are responsible for the accuracy and lawfulness of property, unit, applicant, tenant, lease, rent, maintenance and related information entered into the platform. NesAfric provides software tools and does not replace legal, property-management, valuation, accounting or regulatory advice.</>],
  ["6. Landlord and tenant obligations", <>Use of NesAfric does not alter the legal rights or obligations of landlords, tenants, agents or property managers. Parties remain responsible for complying with applicable tenancy, rent, property and consumer laws, including any notice, documentation, deposit or rent requirements that apply to their transaction.</>],
  ["7. Marketplace listings and professional services", <>Users who publish listings, professional profiles, developments or service offerings are responsible for ensuring that descriptions, prices, availability, credentials, images and representations are accurate and lawful. NesAfric may facilitate discovery and communication but does not automatically become a party to agreements formed between marketplace participants.</>],
  ["8. Verification and platform trust", <>We may request verification information, review profiles, restrict visibility, suspend listings or accounts, or take other proportionate steps to protect platform integrity. A platform verification status is not a guarantee of quality, financial standing, title, professional competence or future performance.</>],
  ["9. Payments, rent collection and billing", <>NesAfric may support billing, rent collection, receipts, reconciliation and payment-related workflows. Where regulated payment services are needed, they may be supplied by banks, electronic-money issuers or payment service providers authorised under applicable law. Unless expressly stated otherwise, NesAfric is not the bank, deposit-taking institution, escrow provider or regulated payment institution holding customer funds.</>],
  ["10. Subscriptions and fees", <>Paid plans may include usage limits, feature entitlements, billing cycles and other conditions shown at purchase or in your account. You are responsible for applicable fees and taxes. We may change pricing or plan features prospectively, with reasonable notice where appropriate.</>],
  ["11. Electronic records and signatures", <>The platform may support electronic records, approvals, acknowledgements or signature workflows. Parties remain responsible for ensuring that the method used is appropriate for the transaction and satisfies any legal formality that applies. A NesAfric workflow should not be treated as legal advice about the enforceability of a document.</>],
  ["12. AI and automated features", <>Some NesAfric features may use artificial intelligence, automation or rule-based systems to summarise information, draft content, classify records, suggest actions or assist workflows. Outputs may be incomplete or incorrect and should be reviewed by an authorised person before decisions are made, especially for legal, financial, tenancy, safety or compliance matters.</>],
  ["13. Communications", <>The platform may support email, SMS, WhatsApp, voice, in-app messaging or other communication channels. Users are responsible for having appropriate authority or consent to contact recipients and for complying with applicable marketing, privacy and communications laws.</>],
  ["14. Acceptable use", <>You must not use NesAfric to commit fraud, impersonate another person, infringe rights, upload unlawful or malicious material, bypass security controls, scrape or overload the service, probe for vulnerabilities without authorisation, interfere with other users or use the platform for prohibited or unlawful activity.</>],
  ["15. User content and permissions", <>You retain rights in content you lawfully submit. You grant NesAfric the permissions reasonably necessary to host, process, display, transmit, back up and otherwise handle that content to operate and improve the services. You are responsible for having the rights and permissions needed for content you upload.</>],
  ["16. Intellectual property", <>NesAfric and its software, design, branding, documentation and platform technology are protected by applicable intellectual-property laws. Except for rights expressly granted to use the service, no ownership rights are transferred to you.</>],
  ["17. Third-party services", <>NesAfric may integrate with third-party infrastructure, communications, payments, maps, storage, analytics or other services. Their own terms and policies may apply. We are not responsible for third-party services outside our reasonable control.</>],
  ["18. Availability, maintenance and changes", <>We may maintain, upgrade, modify, add or remove features as the platform evolves. We work to provide a reliable service but do not guarantee uninterrupted availability. Planned or emergency maintenance, provider outages, network failures and events outside reasonable control may affect access.</>],
  ["19. Suspension and termination", <>We may suspend or restrict access where reasonably necessary to protect users or the platform, investigate suspected misuse, respond to legal obligations, address unpaid fees or enforce these terms. You may stop using the service and may cancel paid services subject to applicable billing terms.</>],
  ["20. Disclaimers", <>To the maximum extent permitted by law, NesAfric is provided on an &quot;as available&quot; basis. Marketplace information, user-generated content, AI outputs and third-party information may contain errors. You should independently verify information important to a property, tenancy, payment, legal or commercial decision.</>],
  ["21. Liability", <>Nothing in these terms excludes liability that cannot lawfully be excluded. To the extent permitted by applicable law, NesAfric is not liable for indirect, incidental, special or consequential losses arising from use of the platform, third-party conduct or decisions made solely in reliance on unverified platform information.</>],
  ["22. Privacy", <>Our <Link className="font-semibold text-forest" href="/privacy">Privacy Policy</Link> explains how personal information is handled. Organisations using NesAfric are also responsible for their own obligations when they determine why and how personal information is processed.</>],
  ["23. Governing law and disputes", <>These terms are intended to be governed by the laws applicable to the NesAfric contracting entity and the relevant transaction. For Ghana-based operations, Ghanaian law may apply. Specific enterprise agreements may contain different dispute-resolution or jurisdiction provisions.</>],
  ["24. Changes to these terms", <>We may update these terms as the platform, law or business model changes. Material changes will be published with an updated date and, where appropriate, additional notice.</>],
  ["25. Contact", <>Questions about these terms can be sent to <a className="font-semibold text-forest hover:text-emerald" href={`mailto:${BRAND.contact.info}`}>{BRAND.contact.info}</a>.</>],
] as const;

export default function TermsPage() {
  return (
    <>
      <SiteNav />
      <main className="bg-warm-white px-5 py-16 sm:px-8 sm:py-24">
        <article className="mx-auto max-w-4xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">LEGAL</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-forest-deep sm:text-5xl">Terms & Conditions</h1>
          <p className="mt-5 text-sm text-muted">Last updated: 23 September 2026</p>
          <p className="mt-7 max-w-3xl text-base leading-7 text-muted">
            These terms set the rules for using NesAfric&apos;s operating system, marketplace and related services.
          </p>

          <div className="mt-12 space-y-10 text-[15px] leading-7 text-muted">
            {sections.map(([title, body]) => (
              <section key={title}>
                <h2 className="text-xl font-semibold text-forest-deep">{title}</h2>
                <p className="mt-3">{body}</p>
              </section>
            ))}
          </div>

          <div className="mt-14 border-t border-hairline pt-7 text-sm text-muted">
            See also our <Link className="font-semibold text-forest" href="/privacy">Privacy Policy</Link> and <Link className="font-semibold text-forest" href="/cookies">Cookie Policy</Link>.
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
