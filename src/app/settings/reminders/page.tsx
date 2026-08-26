import Link from "next/link";
import { ReminderSettings } from "@/components/reminder-settings";

export default function ReminderSettingsPage() {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
    <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row"><div><p className="text-sm font-semibold text-emerald-700">ORGANISATION SETTINGS</p><h1 className="mt-1 text-3xl font-semibold">Lease-expiry reminders</h1><p className="mt-2 max-w-2xl text-slate-600">Manage future reminder thresholds and delivery channels. Existing notification history remains unchanged.</p></div><Link className="self-start rounded-lg border px-4 py-2 text-sm font-semibold" href="/dashboard">Back to dashboard</Link></header>
    <ReminderSettings />
  </main>;
}
