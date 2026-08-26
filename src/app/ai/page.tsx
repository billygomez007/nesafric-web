import Link from "next/link";
import { AIPropertyManager } from "@/components/ai-property-manager";

export default function AIWorkspacePage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-sm font-semibold text-emerald-700">PROPERTYOS AI</p>
          <h1 className="mt-1 text-3xl font-semibold">AI property manager</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Review organisation-scoped operational signals, ask for deterministic summaries,
            and approve proposed actions.
          </p>
        </div>
        <div className="flex gap-2">
          <Link className="self-start rounded-lg border px-4 py-2 text-sm font-semibold" href="/ai/employees">AI Employees</Link>
          <Link className="self-start rounded-lg border px-4 py-2 text-sm font-semibold" href="/ai/autonomy">Autonomy and activity</Link>
          <Link className="self-start rounded-lg border px-4 py-2 text-sm font-semibold" href="/dashboard">Back to dashboard</Link>
        </div>
      </header>
      <AIPropertyManager />
    </main>
  );
}
