import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { buttonClass } from "@/components/ui/button-styles";

export default function NotFound() {
  return (
    <>
      <SiteNav />
      <main className="bg-warm-white px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-[1400px]">
          <p className="text-sm font-medium text-gold-ink">Page not found</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-[-0.02em] text-forest-deep sm:text-[40px] sm:leading-[1.1]">
            We couldn&apos;t find that page.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted">
            The link may be out of date, or the listing may no longer be available.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className={buttonClass("primary")} href="/marketplace/properties">
              Browse properties
            </Link>
            <Link className={buttonClass("secondary")} href="/">
              Go to the homepage
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
