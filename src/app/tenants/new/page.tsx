import { TenantForm } from "@/components/tenant-form";

export default function NewTenantPage() {
  return <main className="mx-auto max-w-2xl px-6 py-12"><p className="text-sm font-semibold text-emerald-700">PEOPLE</p><h1 className="mt-2 text-3xl font-semibold">Add tenant</h1><p className="mt-2 text-slate-600">A tenant record is separate from a PropertyOS user account.</p><TenantForm /></main>;
}
