import { ProductMockup } from "@/components/marketing/product-mockup";

const MODULES = [
  "Properties",
  "Tenants",
  "Leases",
  "Listings",
  "Developments",
  "Leads",
  "CRM",
  "Payments",
  "Maintenance",
  "Documents",
  "Communications",
  "AI",
];

export function OperatingSystemSection() {
  return (
    <section className="scroll-mt-16 bg-slate-50 py-24 sm:py-32" id="operating-system">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-emerald-700">THE PLATFORM</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            One system. Every operation, connected.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Every part of the real estate business runs on the same data — not a collection of disconnected
            tools stitched together after the fact.
          </p>
        </div>

        <div className="mt-14 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-950 px-6 py-4">
            <p className="text-sm font-semibold tracking-tight text-white">Umo Afric</p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-3 lg:grid-cols-4">
            {MODULES.map((module) => (
              <div className="flex items-center gap-3 bg-white px-6 py-6" key={module}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium text-slate-800">{module}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16">
          <ProductMockup
            alt="Umo Afric dashboard showing property management, marketplace, leads, payments and AI employees working together in one platform"
            src="/marketing/mockups/homepage-platform-overview.png"
          />
        </div>
      </div>
    </section>
  );
}
