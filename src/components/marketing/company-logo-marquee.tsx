const PLACEHOLDER_LOGOS = [
  "Company 01",
  "Company 02",
  "Company 03",
  "Company 04",
  "Company 05",
  "Company 06",
];

function LogoStrip() {
  return (
    <div className="flex shrink-0 items-center gap-12 pr-12 sm:gap-16 sm:pr-16" aria-hidden="true">
      {PLACEHOLDER_LOGOS.map((name) => (
        <div
          className="flex h-9 min-w-[132px] items-center justify-center rounded-full border border-forest/10 bg-white px-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-forest/45 transition hover:border-gold/40 hover:text-forest"
          key={name}
        >
          {name}
        </div>
      ))}
    </div>
  );
}

export function CompanyLogoMarquee() {
  return (
    <section className="border-y border-hairline bg-white" aria-label="Companies on NesAfric">
      <div className="mx-auto grid max-w-[1400px] items-center gap-4 px-5 py-4 sm:px-8 lg:grid-cols-[220px_1fr]">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.19em] text-gold">ON THE PLATFORM</p>
          <p className="mt-1 text-sm font-semibold text-forest-deep">Companies building with NesAfric</p>
        </div>

        <div className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-white to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-white to-transparent" />
          <div className="nesafric-logo-marquee flex w-max items-center py-1">
            <LogoStrip />
            <LogoStrip />
          </div>
        </div>
      </div>
    </section>
  );
}
