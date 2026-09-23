import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ProviderDetail } from "@/components/provider-detail";

export default async function ProviderDetailPage({ params }: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await params;
  return <AppShell actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/providers">Back to providers</Link>} description="Review verification, service coverage, assignments, ratings, and marketplace visibility." eyebrow="SERVICE PROFESSIONAL" title="Provider detail"><ProviderDetail providerId={providerId} /></AppShell>;
}
