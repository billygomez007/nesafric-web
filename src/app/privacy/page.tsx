import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { BRAND } from "@/platform/brand";

const sections = [
  {
    title: "1. Who we are",
    body: (
      <>
        <p>
          {BRAND.name} provides property-management, marketplace, communication,
          payment-support and related technology for the African real-estate
          ecosystem.
        </p>
        <p>
          For privacy questions or requests, contact{" "}
          <a
            className="font-semibold text-forest hover:text-emerald"
            href={`mailto:${BRAND.contact.info}`}
          >
            {BRAND.contact.info}
          </a>
          .
        </p>
      </>
    ),
  },
  {
    title: "2. Scope of this policy",
    body: (
      <>
        <p>
          This Privacy Policy applies when you use our websites, applications,
          dashboards, marketplace, communications, support channels and other
          services that link to this policy.
        </p>
        <p>
          It is intended to operate alongside applicable privacy and
          data-protection laws, including Ghana&apos;s Data Protection Act, 2012
          (Act 843), where applicable.
        </p>
      </>
    ),
  },
  {
    title: "3. Information we may collect",
    body: (
      <>
        <p>
          Depending on your relationship with NesAfric, we may collect account
          and identity information, contact details, organisation and team
          information, property and unit records, tenancy and lease information,
          maintenance records, listings, enquiries, communications and support
          history.
        </p>
        <p>
          Where relevant to a feature you use, we may also process transaction
          references and payment-related records, uploaded documents,
          professional or business verification information, device and browser
          information, IP address, security logs, usage information and
          preferences.
        </p>
        <p>
          Please avoid uploading information that is not reasonably necessary
          for the service you are using.
        </p>
      </>
    ),
  },
  {
    title: "4. Information about other people",
    body: (
      <>
        <p>
          Property owners, managers, professionals and organisations may enter
          information about tenants, applicants, employees, service providers,
          clients or other individuals.
        </p>
        <p>
          If you provide personal information about another person, you are
          responsible for having an appropriate legal basis or authority to do
          so and for giving any notices required by applicable law.
        </p>
      </>
    ),
  },
  {
    title: "5. How we use personal information",
    body: (
      <>
        <p>
          We may use personal information to create and administer accounts,
          provide workspaces and property-management features, support lease and
          tenancy workflows, operate marketplace and communication features,
          process user instructions, provide customer support, secure the
          platform, prevent fraud and misuse, maintain audit records and improve
          our services.
        </p>
        <p>
          We may also use information to send transactional and service
          communications, comply with legal obligations, respond to lawful
          requests and enforce our agreements.
        </p>
      </>
    ),
  },
  {
    title: "6. Legal bases and consent",
    body: (
      <>
        <p>
          Where applicable law requires a legal basis for processing, we rely on
          grounds such as performance of a contract, compliance with legal
          obligations, legitimate business interests, protection of users and
          the platform, and consent where consent is appropriate or required.
        </p>
        <p>
          Where processing is based on consent, you may withdraw that consent
          subject to legal and technical limitations. Withdrawal does not affect
          processing that was lawful before withdrawal.
        </p>
      </>
    ),
  },
  {
    title: "7. Payments and financial information",
    body: (
      <>
        <p>
          NesAfric may support payment-related workflows, billing records,
          receipts, reconciliation and transaction references. Where a regulated
          payment service is required, payment processing may be provided by
          appropriately authorised banks, electronic-money issuers or payment
          service providers.
        </p>
        <p>
          NesAfric does not become a bank, deposit-taking institution or
          licensed payment service provider merely because the platform
          displays, initiates or records a payment-related workflow.
        </p>
      </>
    ),
  },
  {
    title: "8. Marketplace, professionals and third parties",
    body: (
      <>
        <p>
          When you contact or transact with a property owner, tenant,
          professional, service provider, developer or other marketplace
          participant, information may be shared with that participant as needed
          for the interaction you requested.
        </p>
        <p>
          Those third parties may independently determine how they use
          information they receive. Their own privacy notices may apply to their
          processing.
        </p>
      </>
    ),
  },
  {
    title: "9. Service providers and disclosures",
    body: (
      <>
        <p>
          We may use trusted technology, hosting, email, communications,
          analytics, storage, security, support and payment partners to operate
          the platform. They may process information for us under appropriate
          contractual or legal safeguards.
        </p>
        <p>
          We may also disclose information where required by law, court order or
          lawful regulatory request, to protect rights or safety, to investigate
          misuse, or in connection with a corporate transaction subject to
          appropriate safeguards.
        </p>
        <p>We do not sell personal information to advertisers.</p>
      </>
    ),
  },
  {
    title: "10. International and cross-border processing",
    body: (
      <>
        <p>
          NesAfric is built to support operations across Africa. Some service
          providers or infrastructure may process information outside the
          country where the information was collected.
        </p>
        <p>
          Where cross-border transfer rules apply, we will take steps designed
          to ensure an appropriate legal basis and safeguards for the transfer.
        </p>
      </>
    ),
  },
  {
    title: "11. Security",
    body: (
      <>
        <p>
          We use technical and organisational measures designed to protect
          information against unauthorised access, loss, misuse, alteration and
          disclosure. Security controls may include access restrictions,
          authentication, encryption in appropriate contexts, logging, backups
          and provider controls.
        </p>
        <p>
          No internet service can guarantee absolute security, so users should
          also protect their credentials and promptly report suspected
          compromise.
        </p>
      </>
    ),
  },
  {
    title: "12. Retention",
    body: (
      <>
        <p>
          We retain personal information for as long as reasonably necessary for
          the purposes described in this policy, including to provide the
          service, maintain transaction and audit records, resolve disputes,
          comply with law and protect legitimate business interests.
        </p>
        <p>
          Retention periods may differ depending on the type of information, the
          feature involved, contractual requirements and applicable law.
        </p>
      </>
    ),
  },
  {
    title: "13. Your privacy rights",
    body: (
      <>
        <p>
          Subject to applicable law, you may have rights to request access to
          personal information, correction of inaccurate information, deletion
          or blocking in certain circumstances, restriction or objection to
          certain processing, and information about how your data is used.
        </p>
        <p>
          You can request deletion of your NesAfric account and associated
          personal data through the mobile app under Account → Delete account,
          or through our{" "}
          <Link className="font-semibold text-forest" href="/account-deletion">
            account deletion page
          </Link>
          .
        </p>
        <p>
          We may need to verify your identity before acting on a request. Some
          requests may be limited where retention or processing is required by
          law, necessary for legal claims, security, fraud prevention or the
          rights of others.
        </p>
      </>
    ),
  },
  {
    title: "14. Children",
    body: (
      <>
        <p>
          NesAfric is intended primarily for adults and organisations involved
          in real estate. The platform is not designed as a child-directed
          service.
        </p>
        <p>
          If a lawful property or tenancy workflow requires information relating
          to a minor, the organisation entering that information is responsible
          for ensuring the information is collected and used lawfully.
        </p>
      </>
    ),
  },
  {
    title: "15. Complaints",
    body: (
      <>
        <p>
          Please contact us first so we can try to resolve a privacy concern. In
          Ghana, individuals may also have the right to raise concerns with the
          Data Protection Commission in accordance with applicable law.
        </p>
      </>
    ),
  },
  {
    title: "16. Changes to this policy",
    body: (
      <>
        <p>
          We may update this policy as NesAfric evolves, as our service
          providers change or as legal requirements develop. We will publish the
          updated version on this page and change the &quot;Last updated&quot;
          date.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <>
      <SiteNav />
      <main className="bg-warm-white px-5 py-16 sm:px-8 sm:py-24">
        <article className="mx-auto max-w-4xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">
            LEGAL
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-forest-deep sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-5 text-sm text-muted">
            Last updated: 23 September 2026
          </p>
          <p className="mt-7 max-w-3xl text-base leading-7 text-muted">
            This policy explains how NesAfric handles personal information
            across our property-management, marketplace and related services.
          </p>

          <div className="mt-12 space-y-10 text-[15px] leading-7 text-muted">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-xl font-semibold text-forest-deep">
                  {section.title}
                </h2>
                <div className="mt-3 space-y-3">{section.body}</div>
              </section>
            ))}
          </div>

          <div className="mt-14 border-t border-hairline pt-7 text-sm text-muted">
            Also see our{" "}
            <Link className="font-semibold text-forest" href="/terms">
              Terms & Conditions
            </Link>{" "}
            and{" "}
            <Link className="font-semibold text-forest" href="/cookies">
              Cookie Policy
            </Link>
            .
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
