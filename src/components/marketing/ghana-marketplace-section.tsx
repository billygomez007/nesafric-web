const SOURCES = ["Agents", "Brokers", "Brokerages", "Real estate companies", "Developers", "Owners, where applicable"];

const ON_EVERY_LISTING = [
  ["Who published it", "The professional or business responsible for the property — never an anonymous post."],
  ["What kind of business they are", "Agent, brokerage, developer or owner, shown on their public profile."],
  ["Whether it has been verified", "Listings are checked for authority to list before they can be published."],
  ["How to reach them", "Enquiries and viewing requests go straight to the lister's lead inbox."],
];

export function GhanaMarketplaceSection() {
  return (
    <section className="bg-warm-white py-16 sm:py-24">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="text-sm font-medium text-gold-ink">The NesAfric marketplace</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-forest-deep sm:text-[40px] sm:leading-[1.1]">
            Not a wall of anonymous ads.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Buyers and renters can see who they&apos;re dealing with before they make contact. Listings come from{" "}
            {SOURCES.slice(0, -1).join(", ").toLowerCase()} and {SOURCES[SOURCES.length - 1].toLowerCase()}.
          </p>
        </div>

        <div>
          <p className="text-sm font-semibold text-forest-deep">On every listing</p>
          <dl className="mt-3 divide-y divide-hairline border-y border-hairline">
            {ON_EVERY_LISTING.map(([label, detail]) => (
              <div className="grid gap-1 py-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:gap-6" key={label}>
                <dt className="text-sm font-semibold text-forest-deep">{label}</dt>
                <dd className="text-sm leading-6 text-slate-600">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
