import { OnboardingForm } from "@/components/onboarding-form";

export default function OnboardingPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-semibold text-emerald-700">STEP 1 OF 2</p>
      <h1 className="mt-3 text-3xl font-semibold">Set up your organisation</h1>
      <p className="mt-2 text-slate-600">Ghana is available now. Its default operating currency is GHS.</p>
      <OnboardingForm />
    </main>
  );
}
