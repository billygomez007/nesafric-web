"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Development = { id: string; name: string; status: string; city: string | null; region: string | null; _count: { units: number } };

export function MarketplaceDevelopmentsDashboard({ professionalId }: { professionalId: string }) {
  const [developments, setDevelopments] = useState<Development[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/marketplace-professionals/${professionalId}/developments`).then(async (response) => {
      const body = await response.json();
      if (response.ok) setDevelopments(body);
      else setError(body.error?.message ?? "Unable to load developments.");
    });
  }, [professionalId]);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>;
  if (!developments) return <p className="text-slate-600">Loading…</p>;

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Developments</h1>
          <p className="mt-1 text-sm text-slate-600">Projects and their sellable/rentable unit inventory.</p>
        </div>
        <Link className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href={`/pro/${professionalId}/developments/new`}>
          New development
        </Link>
      </div>
      {developments.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-slate-600">No developments yet.</p>
      ) : (
        <div className="grid gap-3">
          {developments.map((development) => (
            <Link className="rounded-xl border bg-white p-5 shadow-sm transition hover:border-emerald-500" href={`/pro/${professionalId}/developments/${development.id}`} key={development.id}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{development.name}</p>
                  <p className="text-sm text-slate-500">{[development.city, development.region].filter(Boolean).join(", ") || "Location not set"} · {development._count.units} units</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{development.status.replaceAll("_", " ")}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
