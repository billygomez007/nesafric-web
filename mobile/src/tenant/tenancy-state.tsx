import { ApiError, NETWORK_ERROR } from "@/api/client";
import type { useTenancies } from "@/api/tenant-queries";
import { useSession } from "@/auth/session";
import { Loading, StateMessage } from "@/components/ui";

/** Shown while the server's tenancy list loads, fails, or doesn't include the home in the route. */
export function TenancyUnavailable({ tenancies }: { tenancies: ReturnType<typeof useTenancies> }) {
  const { status } = useSession();
  if (status === "signedOut") return <StateMessage title="Signed out" message="Sign in from the Account tab to see your home." />;
  if (tenancies.isPending) return <Loading />;
  if (!tenancies.data) {
    const offline = tenancies.error instanceof ApiError && tenancies.error.code === NETWORK_ERROR;
    return (
      <StateMessage
        title={offline ? "You’re offline" : "Couldn’t load your homes"}
        message={offline ? "Check your connection and try again." : tenancies.error instanceof Error ? tenancies.error.message : "Please try again."}
        actionLabel="Try again"
        onAction={() => void tenancies.refetch()}
      />
    );
  }
  return <StateMessage title="This home isn’t available" message="It isn’t linked to your account. If you think this is wrong, contact your landlord or property manager." />;
}
