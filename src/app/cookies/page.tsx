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
          <p className="mt-7 max-w-3xl text-base leading-7 text-muted">
            This policy explains how NesAfric may use cookies and similar technologies on our websites and applications.
          </p>

          <div className="mt-12 space-y-10 text-[15px] leading-7 text-muted">
            <section>
              <h2 className="text-xl font-semibold text-forest-deep">1. What cookies and similar technologies are</h2>
              <p className="mt-3">Cookies are small data files stored by a browser. Similar technologies can include local storage, session storage, pixels, software-development kits and other mechanisms used to remember information or support website and application functions.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-forest-deep">2. Strictly necessary technologies</h2>
              <p className="mt-3">We may use technologies that are necessary to provide requested services, keep users signed in, preserve security settings, prevent abuse, route traffic, maintain sessions and remember essential choices. Disabling these technologies may prevent parts of NesAfric from working correctly.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-forest-deep">3. Preferences</h2>
              <p className="mt-3">Where enabled, preference technologies may remember choices such as interface settings, region, language or other non-essential preferences so that you do not need to re-enter them on every visit.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-forest-deep">4. Analytics and performance</h2>
              <p className="mt-3">Where enabled and permitted, analytics technologies may help us understand how visitors use NesAfric, identify errors, measure performance and improve navigation and product design. We may configure analytics to minimise unnecessary collection where practical.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-forest-deep">5. Marketing technologies</h2>
              <p className="mt-3">If NesAfric introduces advertising or marketing cookies in the future, we will use them only where permitted and will provide any consent or preference controls required by applicable law. This policy does not mean that such technologies are currently active.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-forest-deep">6. Third-party technologies</h2>
              <p className="mt-3">Some integrated services may set or read their own technologies when you use them. Examples can include payment, communications, maps, analytics or embedded-content providers. Their own privacy and cookie notices may apply.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-forest-deep">7. Managing cookies</h2>
              <p className="mt-3">Most browsers allow you to block, delete or limit cookies through browser settings. If we provide an in-product cookie preference centre, you may also use that tool for non-essential categories. Blocking strictly necessary technologies may affect sign-in, security and other core functions.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-forest-deep">8. Retention</h2>
              <p className="mt-3">The duration of a cookie or similar technology depends on its purpose. Some expire when your browser session ends, while others remain for a defined period or until deleted.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-forest-deep">9. Changes to this policy</h2>
              <p className="mt-3">We may update this policy when our technologies, service providers or legal obligations change. The updated date at the top of the page will show when the policy was last revised.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-forest-deep">10. Contact</h2>
              <p className="mt-3">Questions about cookies or privacy can be sent to <a className="font-semibold text-forest hover:text-emerald" href={`mailto:${BRAND.contact.info}`}>{BRAND.contact.info}</a>.</p>
            </section>
          </div>

          <div className="mt-14 border-t border-hairline pt-7 text-sm text-muted">
            Read our <Link className="font-semibold text-forest" href="/privacy">Privacy Policy</Link> and <Link className="font-semibold text-forest" href="/terms">Terms & Conditions</Link>.
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
