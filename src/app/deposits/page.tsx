import { AppShell } from "@/components/app-shell";
import { DepositManager } from "@/components/deposit-manager";

export default function DepositsPage() {
  return (
    <AppShell description="Track held caution deposits separately from rent revenue." eyebrow="DEPOSIT FOUNDATION" title="Security deposits">
      <DepositManager />
    </AppShell>
  );
}
