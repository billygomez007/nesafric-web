import { AppShell } from "@/components/app-shell";
import Link from "next/link";
import { MaintenanceDetail } from "@/components/maintenance-detail";

export default async function MaintenanceRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <AppShell actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/maintenance">Back to maintenance</Link>} description="Triage the issue, coordinate work orders, and keep a complete operational history." eyebrow="MAINTENANCE REQUEST" title="Request details"><MaintenanceDetail requestId={requestId} /></AppShell>;
}
