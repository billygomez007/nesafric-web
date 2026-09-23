import { AccountSettings } from "@/components/account-settings";
import { MarketplaceProShell } from "@/components/marketplace-pro-shell";

export default async function ProfessionalSettingsPage({
  params,
}: {
  params: Promise<{ professionalId: string }>;
}) {
  const { professionalId } = await params;

  return (
    <MarketplaceProShell professionalId={professionalId}>
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
            ACCOUNT SETTINGS
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
            Profile & account
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Manage the personal account shared across your NesAfric workspaces.
          </p>
        </header>

        <AccountSettings />
      </div>
    </MarketplaceProShell>
  );
}
