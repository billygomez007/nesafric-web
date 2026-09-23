import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PropertyList } from "@/components/property-list";

export default function PropertiesPage() {
  return (
    <AppShell
      actions={
        <Link
          className="inline-flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-forest-light"
          href="/properties/new"
        >
          <span className="text-base leading-none">+</span>
          Add property
        </Link>
      }
      description="Manage every property, building and unit in your portfolio."
      eyebrow="PORTFOLIO"
      title="Properties"
    >
      <PropertyList />
    </AppShell>
  );
}
