"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Professional = { id: string; displayName: string; type: string; status: string; verificationStatus: string; myRole: string };

export default function MarketplaceProfessionalsPage() {
  const [professionals, setProfessionals] = useState<Professional[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/marketplace-professionals").then(async (response) => {
      const body = await response.json();
      if (response.ok) setProfessionals(body);
      else setError(body.error?.message ?? "Unable to load your marketplace profiles.");
    });
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-sm font-semibold text-emerald-700">UMO AFRIC REAL ESTATE MARKETPLACE</p>
      <h1 className="mt-2 text-3xl font-semibold">Your marketplace profiles</h1>
      <p className="mt-2 text-slate-600">Agents, brokers, brokerages, real-estate companies, and developers each operate as a professional profile here — separate from any PropertyOS management organisation.</p>

      {error && <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
      {!error && !professionals && <p className="mt-6 text-slate-600">Loading…</p>}
      {professionals && professionals.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed p-10 text-center text-slate-600">
          <p>You don&apos;t have a marketplace profile yet.</p>
        </div>
      )}
      {professionals && professionals.length > 0 && (
        <div className="mt-8 grid gap-3">
          {professionals.map((professional) => (
            <Link className="rounded-xl border bg-white p-5 shadow-sm transition hover:border-emerald-500" href={`/pro/${professional.id}`} key={professional.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{professional.displayName}</p>
                  <p className="text-sm text-slate-500">{professional.type.replaceAll("_", " ")} · {professional.myRole}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{professional.verificationStatus}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <Link className="mt-8 inline-block rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/pro/new">
        Add a marketplace profile
      </Link>
    </main>
  );
}
