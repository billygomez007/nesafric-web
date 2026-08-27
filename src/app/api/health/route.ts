import { NextResponse } from "next/server";
import { getPublicHealth } from "@/modules/health/service";

/**
 * Unauthenticated readiness/liveness probe for load balancers, uptime monitors, and orchestrators
 * — deliberately requires no session/organisation, since infra health checks can't authenticate.
 * Returns 200 whenever the application and Postgres are reachable, even if optional integrations
 * are unconfigured; only a real database outage returns 503.
 */
export async function GET() {
  const health = await getPublicHealth();
  return NextResponse.json(health, { status: health.status === "HEALTHY" ? 200 : 503 });
}
