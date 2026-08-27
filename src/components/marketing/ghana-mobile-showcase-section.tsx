import { ProductMockup } from "@/components/marketing/product-mockup";

export function GhanaMobileShowcaseSection() {
  return (
    <section className="bg-slate-50 py-24 sm:py-32">
      <div className="mx-auto max-w-5xl px-6 text-center sm:px-8">
        <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">BUILT FOR AFRICA</p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          Your property business. In your pocket.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-600">
          One platform, three experiences — tenants pay rent and track maintenance, agents manage leads and
          viewings, and landlords monitor their portfolio, all from a phone.
        </p>
      </div>

      <div className="mt-14 px-6 sm:px-8">
        <ProductMockup
          alt="UmoAfric mobile experiences for tenants, agents and landlords, shown side by side on three phones"
          maxWidthClassName="max-w-4xl"
          src="/marketing/mockups/mobile-three-experiences.png"
          theme="light"
        />
      </div>
    </section>
  );
}
