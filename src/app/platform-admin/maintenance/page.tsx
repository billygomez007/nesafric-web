"use client";

import { FormEvent, useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type MaintenanceResponse = {
  summary: {
    total: number;
    openWorkOrders: number;
    overdueWorkOrders: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  };
  requests: Array<{
    id: string;
    title: string;
    category: string;
    priority: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    organisation: {
      id: string;
      name: string;
    };
    property: {
      id: string;
      name: string;
    };
    unit: {
      id: string;
      name: string;
    } | null;
    reportedBy: {
      id: string;
      displayName: string;
    };
    _count: {
      workOrders: number;
      approvals: number;
      attachments: number;
      conversations: number;
      dispatchAttempts: number;
    };
  }>;
};

const STATUSES = [
  "",
  "REPORTED",
  "TRIAGED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
];

function MaintenanceContent() {
  const [data, setData] = useState<MaintenanceResponse | null>(null);
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

    fetch(`/api/platform-admin/maintenance?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load maintenance operations.",
          );
        }

        return body as MaintenanceResponse;
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
            : "Unable to load maintenance operations.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
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

  return (
    <div className="grid gap-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          Operations
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-forest">
          Maintenance Oversight
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Platform-wide operational visibility into maintenance requests,
          work orders, approvals and dispatch activity.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total requests", data?.summary.total ?? 0],
          ["Reported", data?.summary.byStatus.REPORTED ?? 0],
          ["In progress", data?.summary.byStatus.IN_PROGRESS ?? 0],
          ["Open work orders", data?.summary.openWorkOrders ?? 0],
          ["Overdue work orders", data?.summary.overdueWorkOrders ?? 0],
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
          className="rounded-lg border border-hairline px-4 py-2.5 text-sm"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Request, category, organisation or property"
          value={search}
        />

        <select
          className="rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm"
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
        <p className="text-sm text-muted">Loading maintenance operations…</p>
      ) : !data?.requests.length ? (
        <div className="rounded-xl border border-hairline bg-white p-8 text-center shadow-card">
          <p className="font-semibold text-forest">
            No maintenance requests found.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-left text-sm">
              <thead className="border-b border-hairline bg-warm-white text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-4">Request</th>
                  <th className="px-5 py-4">Organisation</th>
                  <th className="px-5 py-4">Property</th>
                  <th className="px-5 py-4">Priority</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Work orders</th>
                  <th className="px-5 py-4">Dispatch</th>
                  <th className="px-5 py-4">Updated</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-hairline">
                {data.requests.map((request) => (
                  <tr
                    className="align-top hover:bg-warm-white/60"
                    key={request.id}
                  >
                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {request.title}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {request.category}
                      </p>
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {request.organisation.name}
                    </td>

                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold text-forest">
                        {request.property.name}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {request.unit?.name ?? "Property-level request"}
                      </p>
                    </td>

                    <td className="px-5 py-4 text-xs font-semibold text-forest">
                      {request.priority}
                    </td>

                    <td className="px-5 py-4 text-xs font-semibold text-forest">
                      {request.status.replaceAll("_", " ")}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {request._count.workOrders}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {request._count.dispatchAttempts} attempts
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {new Date(request.updatedAt).toLocaleString()}
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

export default function PlatformAdminMaintenancePage() {
  return (
    <PlatformAdminShell>
      <MaintenanceContent />
    </PlatformAdminShell>
  );
}
