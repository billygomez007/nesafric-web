import { MarketplaceProfessionalOnboardingForm } from "@/components/marketplace-professional-onboarding-form";

export default function NewMarketplaceProfessionalPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-semibold text-emerald-700">UMO AFRIC REAL ESTATE MARKETPLACE</p>
      <h1 className="mt-2 text-3xl font-semibold">Add a marketplace profile</h1>
      <p className="mt-2 text-slate-600">One user identity can hold any number of marketplace profiles alongside any PropertyOS management organisations.</p>
      <MarketplaceProfessionalOnboardingForm />
    </main>
  );
}
