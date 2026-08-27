import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ProviderForm } from "@/components/provider-form";

export default function NewProviderPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href="/providers">
          Provider directory
        </Link>
      }
      description="Profiles reuse existing user or organisation identity and can join multiple private directories."
      eyebrow="REGISTER PROVIDER"
      size="medium"
      title="Create a provider profile"
    >
      <ProviderForm />
    </AppShell>
  );
}
