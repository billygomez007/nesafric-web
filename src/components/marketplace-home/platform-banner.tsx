import Link from "next/link";

/**
 * NesAfric's own banner for the homepage advertising slot, shown only when no marketplace campaign
 * is running. It is platform content (labelled "From NesAfric", never "Promoted"), matches the
 * campaign carousel's height so the hero doesn't jump, and makes no claims about listings or
 * companies.
 */
export function PlatformBanner() {
  return (
    <div className="relative flex h-64 items-center overflow-hidden bg-forest sm:h-72 lg:h-80" data-testid="platform-banner">
      <svg aria-hidden="true" className="pointer-events-none absolute -right-10 bottom-0 hidden h-[115%] text-gold/15 sm:block" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.2" viewBox="0 0 320 240">
        <path d="M20 236V120L120 44l100 76v116" />
        <path d="M150 236V150h-60v86" />
        <path d="M190 90 250 44l60 46v146h-90" />
        <path d="M240 236v-50h40v50" />
        <path d="M6 236h314" />
      </svg>
      <div className="relative flex max-w-xl flex-col gap-2 px-6 sm:px-10">
        <span className="text-xs font-semibold text-gold-soft">From NesAfric</span>
        <h2 className="font-display text-xl font-semibold leading-tight text-white sm:text-[28px]">List your property on NesAfric</h2>
        <p className="max-w-md text-sm leading-6 text-white/80">Reach renters and buyers across Ghana.</p>
        <Link
          className="mt-2 inline-flex min-h-10 w-fit items-center rounded-[var(--radius-control)] bg-gold px-4 text-sm font-semibold text-forest-deep transition-colors hover:bg-gold-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-soft"
          href="/for-professionals"
        >
          List a property
        </Link>
      </div>
    </div>
  );
}
