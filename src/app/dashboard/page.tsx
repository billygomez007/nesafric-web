import Link from "next/link";
import { DashboardContent } from "@/components/dashboard-content";

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold text-emerald-700">PROPERTYOS AI</p><h1 className="text-3xl font-semibold">Organisation dashboard</h1></div><div className="flex flex-wrap gap-2"><Link className="rounded border px-4 py-2 font-semibold" href="/ai">AI workspace</Link><Link className="rounded border px-4 py-2 font-semibold" href="/inbox">Inbox</Link><Link className="rounded border px-4 py-2 font-semibold" href="/leasing">Leasing CRM</Link><Link className="rounded border px-4 py-2 font-semibold" href="/listings">Listings</Link><Link className="rounded border px-4 py-2 font-semibold" href="/marketplace">Marketplace</Link><Link className="rounded border px-4 py-2 font-semibold" href="/providers">Providers</Link><Link className="rounded border px-4 py-2 font-semibold" href="/maintenance">Maintenance</Link><Link className="rounded border px-4 py-2 font-semibold" href="/payments">Rent collection</Link><Link className="rounded border px-4 py-2 font-semibold" href="/documents">Documents</Link><Link className="rounded border px-4 py-2 font-semibold" href="/settings/reminders">Reminder settings</Link><Link className="rounded border px-4 py-2 font-semibold" href="/settings/communications">Communications</Link><Link className="rounded border px-4 py-2 font-semibold" href="/settings/integrations">Integrations</Link><Link className="rounded border px-4 py-2 font-semibold" href="/settings/billing">Billing</Link><Link className="rounded bg-slate-950 px-4 py-2 font-semibold text-white" href="/properties/new">Add property</Link></div></header>
      <DashboardContent />
    </main>
  );
}
