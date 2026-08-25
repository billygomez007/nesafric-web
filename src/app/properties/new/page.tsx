import { PropertyForm } from "@/components/property-form";

export default function NewPropertyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm font-semibold text-emerald-700">ASSETS</p><h1 className="mt-2 text-3xl font-semibold">Add property</h1>
      <PropertyForm />
    </main>
  );
}
