import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { BRAND } from "@/platform/brand";

export const metadata = {
  title: "Delete your NesAfric account",
  description:
    "Request deletion of your NesAfric account and associated personal data.",
};

export default function AccountDeletionPage() {
  const subject = encodeURIComponent("NesAfric account deletion request");
  const body = encodeURIComponent(
    [
      "Hello NesAfric Support,",
      "",
      "I would like to request deletion of my NesAfric account and associated personal data.",
      "",
      "Account email or phone number:",
      "",
      "I understand that NesAfric may need to verify my identity before processing this request and may retain limited records where required for legal, regulatory, financial, fraud-prevention, security, audit, tenancy, property-management, dispute, or enforcement purposes.",
      "",
      "Thank you.",
    ].join("\n"),
  );

  return (
    <>
      <SiteNav />
      <main className="bg-warm-white px-5 py-16 sm:px-8 sm:py-24">
        <article className="mx-auto max-w-3xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">
            ACCOUNT & PRIVACY
          </p>

          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-forest-deep sm:text-5xl">
            Delete your NesAfric account
          </h1>

          <p className="mt-6 text-base leading-7 text-muted">
            You can request deletion of your NesAfric account and associated
            personal information at any time.
          </p>

          <section className="mt-10 rounded-2xl border border-hairline bg-white p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-forest-deep">
              Request account deletion
            </h2>

            <p className="mt-3 text-[15px] leading-7 text-muted">
              Send a deletion request from the email address associated with
              your NesAfric account where possible. If your account uses a phone
              number, include that phone number in the request.
            </p>

            <a
              className="mt-6 inline-flex rounded-xl bg-forest px-5 py-3 font-semibold text-white"
              href={`mailto:${BRAND.contact.info}?subject=${subject}&body=${body}`}
            >
              Request account deletion
            </a>

            <p className="mt-4 text-sm leading-6 text-muted">
              Privacy requests can also be sent to{" "}
              <a
                className="font-semibold text-forest"
                href={`mailto:${BRAND.contact.info}`}
              >
                {BRAND.contact.info}
              </a>
              .
            </p>
          </section>

          <section className="mt-10 space-y-4 text-[15px] leading-7 text-muted">
            <h2 className="text-xl font-semibold text-forest-deep">
              What happens after you submit a request?
            </h2>

            <p>
              NesAfric may contact you to verify that you own the account before
              processing the deletion request.
            </p>

            <p>
              After verification, account access and personal information
              associated with the account will be deleted or anonymised where
              reasonably possible.
            </p>

            <p>
              Some information may need to be retained where required for legal,
              regulatory, financial, fraud-prevention, security, audit,
              property-management, tenancy, dispute-resolution, contractual, or
              enforcement purposes. Any retained information will be limited to
              what is reasonably necessary for those purposes.
            </p>
          </section>

          <section className="mt-10 space-y-4 text-[15px] leading-7 text-muted">
            <h2 className="text-xl font-semibold text-forest-deep">
              Request deletion from the NesAfric app
            </h2>

            <p>
              In the NesAfric mobile app, open <strong>Account</strong> and
              choose <strong>Delete account</strong>. The app will direct you to
              this account-deletion process.
            </p>
          </section>

          <div className="mt-12 border-t border-hairline pt-7 text-sm text-muted">
            Read the{" "}
            <Link className="font-semibold text-forest" href="/privacy">
              NesAfric Privacy Policy
            </Link>
            .
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
