"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Snapshot = {
  status: string;
  trialEndsAt: string | null;
  gracePeriodEndsAt: string | null;
  units: { current: number; limit: number | null };
  entitled: boolean;
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** Trial, renewal and pause notices at the top of the property-management dashboard. Renders
 * nothing for a paid plan in good standing, or when billing cannot be read (e.g. staff without
 * billing access). */
export function PlanStatusBanner() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return;
    let cancelled = false;
    void fetch(`/api/organisations/${organisationId}/billing`, { headers: { "x-organisation-id": organisationId } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled && body) setSnapshot(body as Snapshot); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (!snapshot) return null;
  const atCapacity = snapshot.entitled && snapshot.units.limit !== null && snapshot.units.current >= snapshot.units.limit;
  let message: string | null = null;
  let tone = "border-gold/30 bg-gold/10 text-ink";
  if (snapshot.status === "NOT_ACTIVATED") message = "Start your free trial to manage units, tenants, leases and maintenance. Listing on the marketplace is always free.";
  else if (snapshot.status === "TRIALING" && snapshot.trialEndsAt) message = `Free trial until ${dateFormatter.format(new Date(snapshot.trialEndsAt))}. Choose a plan any time — nothing is charged automatically.`;
  else if (snapshot.status === "PAST_DUE") message = "Your renewal payment is due. Everything keeps working while you pay.";
  else if (snapshot.status === "GRACE_PERIOD") message = `Renewal overdue. Pay before ${snapshot.gracePeriodEndsAt ? dateFormatter.format(new Date(snapshot.gracePeriodEndsAt)) : "the grace period ends"} to avoid a pause.`;
  else if (snapshot.status === "PAYMENT_PENDING") message = "We are confirming your payment with the provider.";
  else if (["EXPIRED", "CANCELLED", "SUSPENDED"].includes(snapshot.status)) {
    message = "Property-management features are paused. Your data is kept and still viewable. Choose a plan to continue.";
    tone = "border-red-200 bg-red-50 text-red-900";
  } else if (atCapacity) message = `${snapshot.units.current} of ${snapshot.units.limit} units used. Upgrade to add more units.`;
  if (!message) return null;

  return (
    <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm ${tone}`} role="status">
      <p className="min-w-0 flex-1">{message}</p>
      <Link className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white hover:bg-emerald" href="/settings/billing">
        {snapshot.status === "NOT_ACTIVATED" ? "Start free trial" : "View plans"}
      </Link>
    </div>
  );
}
