import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ListingEditor } from "@/components/listing-editor";

export default function NewListingPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href="/listings">
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
