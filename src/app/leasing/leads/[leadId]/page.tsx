import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LeadCrmDetail } from "@/components/lead-crm-detail";

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  return (
    <AppShell
      actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/leasing">Back to CRM</Link>}
      description="Qualify interest, coordinate next steps, and keep every prospect interaction connected."
      eyebrow="PROSPECT"
      title="Prospect detail"
    >
      <LeadCrmDetail leadId={leadId} />
    </AppShell>
  );
}
