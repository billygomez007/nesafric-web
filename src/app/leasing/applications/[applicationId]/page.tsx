import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { RentalApplicationDetail } from "@/components/rental-application-detail";

export default async function ApplicationPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  return (
    <AppShell
      actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/leasing">Back to CRM</Link>}
      description="Review applicant readiness, documents, consents, and the next lease step."
      eyebrow="RENTAL APPLICATION"
      title="Application detail"
    >
      <RentalApplicationDetail applicationId={applicationId} />
    </AppShell>
  );
}
