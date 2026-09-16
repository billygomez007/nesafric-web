import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ListingEditor } from "@/components/listing-editor";

export default function NewListingPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/listings">
          Listings dashboard
        </Link>
      }
      description="Create a public marketing record linked to a managed property or unit."
      eyebrow="NEW LISTING"
      size="medium"
      title="Create property marketplace listing"
    >
      <ListingEditor />
    </AppShell>
  );
}
