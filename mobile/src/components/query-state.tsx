import { ApiError, NETWORK_ERROR } from "@/api/client";
import { Loading, StateMessage } from "./ui";

export function QueryState({ isPending, error, onRetry }: { isPending: boolean; error: unknown; onRetry: () => void }) {
  if (isPending) return <Loading />;
  if (error instanceof ApiError && error.code === NETWORK_ERROR) {
    return <StateMessage title="You're offline" message={error.message} actionLabel="Try again" onAction={onRetry} />;
  }
  if (error instanceof ApiError && error.status === 404) {
    return <StateMessage title="No longer available" message="This property has been let, sold or taken down." />;
  }
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return <StateMessage title="Couldn't load this" message={message} actionLabel="Try again" onAction={onRetry} />;
}
