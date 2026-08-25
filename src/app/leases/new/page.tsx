import { LeaseForm } from "@/components/lease-form";

export default function NewLeasePage() {
  return <main className="mx-auto max-w-2xl px-6 py-12"><p className="text-sm font-semibold text-emerald-700">LEASING</p><h1 className="mt-2 text-3xl font-semibold">Create lease</h1><p className="mt-2 text-slate-600">Choose a property and optional unit, then assign one or more organisation-scoped tenant records.</p><LeaseForm /></main>;
}
