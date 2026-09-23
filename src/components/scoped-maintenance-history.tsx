"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Request = {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  property: { name: string };
  unit: { name: string } | null;
  _count: { workOrders: number; attachments: number };
};

export function ScopedMaintenanceHistory({
  scope,
  id,
}: {
  scope: "tenants" | "properties";
  id: string;
}) {
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );
    if (!organisationId) {
      const timer = setTimeout(
        () => setError("Choose an organisation to view maintenance history."),
        0,
      );
      return () => clearTimeout(timer);
    }
    fetch(`/api/maintenance/${scope}/${id}/history`, {
      headers: { "x-organisation-id": organisationId },
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            (await response.json()).error?.message ??
              "Unable to load maintenance history.",
          );
        setRequests(await response.json());
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load maintenance history.",
        ),
      );
  }, [id, scope]);
  if (error)
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
        {error}
      </p>
    );
  if (!requests)
    return <p className="text-sm text-muted">Loading maintenance history...</p>;
  return requests.length ? (
    <div className="grid gap-3">
      {requests.map((request) => (
        <Link
          className="grid gap-3 rounded-xl border border-hairline bg-warm-white p-4 transition hover:border-teal/25 sm:grid-cols-[1fr_auto]"
          href={`/maintenance/${request.id}`}
          key={request.id}
        >
          <div>
            <p className="font-semibold text-ink">{request.title}</p>
            <p className="text-sm text-muted">
              {request.property.name}
              {request.unit ? ` · ${request.unit.name}` : ""} ·{" "}
              {request.category}
            </p>
            <p className="mt-1 text-xs text-muted">
              {new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(
                new Date(request.createdAt),
              )}{" "}
              · {request._count.workOrders} work orders
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="rounded-full bg-gold/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gold">
              {request.priority}
            </span>
            <span className="rounded-full bg-teal/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal">
              {request.status}
            </span>
          </div>
        </Link>
      ))}
    </div>
  ) : (
    <p className="rounded-xl border border-dashed border-hairline p-6 text-center text-sm text-muted">
      No maintenance history.
    </p>
  );
}
