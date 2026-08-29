import { NextResponse } from "next/server";
import { listPendingProviderIdentityReviews, listProvidersForPlatform, PROVIDER_QUEUE_TABS, type ProviderQueueTab } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

const TABS = new Set<string>(PROVIDER_QUEUE_TABS);

/** Platform Service Providers queue. With no `tab` query param, preserves the original behaviour
 * exactly (full pending-review detail, evidence included) for backward compatibility. With a
 * `tab` param (Phase 25's status-tabbed queue), returns the lighter-weight filtered summary list. */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const tabParam = new URL(request.url).searchParams.get("tab");
    if (tabParam) {
      const tab = TABS.has(tabParam as ProviderQueueTab) ? (tabParam as ProviderQueueTab) : "PENDING_VERIFICATION";
      return NextResponse.json(await listProvidersForPlatform(user, tab));
    }
    return NextResponse.json(await listPendingProviderIdentityReviews(user));
  } catch (error) {
    return errorResponse(error);
  }
}
