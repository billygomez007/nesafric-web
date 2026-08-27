import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PropertyList } from "@/components/property-list";

export default function PropertiesPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/properties/new">
          Add property
        </Link>
      }
      description="Every property owned or managed by this organisation."
      eyebrow="ASSETS"
      title="Properties"
    >
      <PropertyList />
    </AppShell>
  );
}
