import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ViewingCrmDetail } from "@/components/viewing-crm-detail";

export default async function ViewingPage({ params }: { params: Promise<{ viewingId: string }> }) {
  const { viewingId } = await params;
  return (
    <AppShell
      actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/leasing">Back to CRM</Link>}
      description="Coordinate preferred times, confirmations, assignments, and viewing outcomes."
      eyebrow="VIEWING"
      title="Viewing detail"
    >
      <ViewingCrmDetail viewingId={viewingId} />
    </AppShell>
  );
}
