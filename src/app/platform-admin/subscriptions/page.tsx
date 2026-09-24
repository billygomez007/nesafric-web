"use client";

import { FormEvent, useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type SubscriptionRow = {
  id: string;
  organisationId: string;
  status: string;
  billingCycle: string;
  currencyCode: string;
  billingProviderKey: string;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  suspendedAt: string | null;
  gracePeriodEndsAt: string | null;
  pastDueSince: string | null;
  createdAt: string;
  updatedAt: string;
  organisation: {
    id: string;
    name: string;
    type: string;
    countryCode: string;
  };
  plan: {
    id: string;
    key: string;
    name: string;
    isActive: boolean;
    isPublic: boolean;
  };
  _count: {
    invoices: number;
    statusHistory: number;
  };
};

type SubscriptionResponse = {
  summary: {
    total: number;
    failedInvoices: number;
    byStatus: Record<string, number>;
  };
  subscriptions: SubscriptionRow[];
};

const STATUSES = [
  "",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
  "SUSPENDED",
  "CANCELLED",
];

function statusTone(status: string) {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald/10 text-emerald";
    case "TRIALING":
      return "bg-teal/10 text-teal";
    case "PAST_DUE":
    case "GRACE_PERIOD":
      return "bg-gold/15 text-forest";
    case "SUSPENDED":
    case "CANCELLED":
      return "bg-red-50 text-red-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function SubscriptionsContent() {
  const [data, setData] = useState<SubscriptionResponse | null>(null);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [status, setStatus] = useState("");
  const [activeStatus, setActiveStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ take: "100" });

    if (activeSearch.trim()) {
      params.set("search", activeSearch.trim());
    }

    if (activeStatus) {
      params.set("status", activeStatus);
    }

    fetch(`/api/platform-admin/subscriptions?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load subscriptions.",
          );
        }

        return body as SubscriptionResponse;
      })
      .then((body) => {
        setData(body);
        setError("");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load subscriptions.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeSearch, activeStatus]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setActiveSearch(search);
    setActiveStatus(status);
  }

  const summary = data?.summary;

  return (
    <div className="grid gap-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          Finance
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-forest">
          Subscriptions
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Platform-wide visibility into plans, trials, billing lifecycle,
          suspensions, grace periods and failed subscription invoices.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ["Total", summary?.total ?? 0],
          ["Active", summary?.byStatus.ACTIVE ?? 0],
          ["Trialing", summary?.byStatus.TRIALING ?? 0],
          ["Past due", summary?.byStatus.PAST_DUE ?? 0],
          ["Suspended", summary?.byStatus.SUSPENDED ?? 0],
          ["Failed invoices", summary?.failedInvoices ?? 0],
        ].map(([label, value]) => (
          <div
            className="rounded-xl border border-hairline bg-white p-4 shadow-card"
            key={String(label)}
          >
            <p className="text-xs uppercase tracking-wider text-muted">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-forest">{value}</p>
          </div>
        ))}
      </section>

      <form
        className="grid gap-3 rounded-xl border border-hairline bg-white p-4 shadow-card md:grid-cols-[1fr_220px_auto_auto]"
        onSubmit={submit}
      >
        <input
          className="rounded-lg border border-hairline px-4 py-2.5 text-sm outline-none focus:border-teal"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search organisation name"
          value={search}
        />

        <select
          className="rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm outline-none focus:border-teal"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          {STATUSES.map((entry) => (
            <option key={entry || "ALL"} value={entry}>
              {entry ? entry.replaceAll("_", " ") : "All statuses"}
            </option>
          ))}
        </select>

        <button
          className="rounded-lg bg-forest px-5 py-2.5 text-sm font-semibold text-white"
          type="submit"
        >
          Apply
        </button>

        <button
          className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-semibold text-forest"
          onClick={() => {
            setLoading(true);
            setSearch("");
            setStatus("");
            setActiveSearch("");
            setActiveStatus("");
          }}
          type="button"
        >
          Reset
        </button>
      </form>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading subscriptions…</p>
      ) : !data?.subscriptions.length ? (
        <div className="rounded-xl border border-hairline bg-white p-8 text-center shadow-card">
          <h3 className="font-semibold text-forest">
            No subscriptions found
          </h3>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-left text-sm">
              <thead className="border-b border-hairline bg-warm-white text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-4">Organisation</th>
                  <th className="px-5 py-4">Plan</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Cycle</th>
                  <th className="px-5 py-4">Provider</th>
                  <th className="px-5 py-4">Current period</th>
                  <th className="px-5 py-4">Invoices</th>
                  <th className="px-5 py-4">Flags</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-hairline">
                {data.subscriptions.map((subscription) => (
                  <tr
                    className="align-top hover:bg-warm-white/60"
                    key={subscription.id}
                  >
                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {subscription.organisation.name}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {subscription.organisation.type.replaceAll("_", " ")} ·{" "}
                        {subscription.organisation.countryCode}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {subscription.plan.name}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {subscription.plan.key}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(
                          subscription.status,
                        )}`}
                      >
                        {subscription.status.replaceAll("_", " ")}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {subscription.billingCycle}
                      <br />
                      {subscription.currencyCode}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {subscription.billingProviderKey}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {new Date(
                        subscription.currentPeriodStart,
                      ).toLocaleDateString()}
                      {" → "}
                      {new Date(
                        subscription.currentPeriodEnd,
                      ).toLocaleDateString()}
                    </td>

                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {subscription._count.invoices}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {subscription._count.statusHistory} lifecycle events
                      </p>
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {subscription.cancelAtPeriodEnd && (
                        <p>Cancellation scheduled</p>
                      )}
                      {subscription.pastDueSince && <p>Past due</p>}
                      {subscription.gracePeriodEndsAt && <p>Grace period</p>}
                      {subscription.suspendedAt && <p>Suspended</p>}
                      {!subscription.cancelAtPeriodEnd &&
                        !subscription.pastDueSince &&
                        !subscription.gracePeriodEndsAt &&
                        !subscription.suspendedAt && <p>Normal</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlatformAdminSubscriptionsPage() {
  return (
    <PlatformAdminShell>
      <SubscriptionsContent />
    </PlatformAdminShell>
  );
}
