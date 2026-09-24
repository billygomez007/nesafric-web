"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type MarketplaceOverview = {
  professionals: {
    total: number;
    verified: number;
    pendingVerification: number;
  };
  listings: {
    total: number;
    publishedAndVerified: number;
    pendingVerification: number;
  };
  providers: {
    total: number;
    verified: number;
    suspended: number;
  };
};

function MarketplaceContent() {
  const [data, setData] = useState<MarketplaceOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/platform-admin/marketplace", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load marketplace overview.",
          );
        }

        return body as MarketplaceOverview;
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
            : "Unable to load marketplace overview.",
        );
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="grid gap-7">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          Marketplace operations
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-forest">
          Marketplace Control Center
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Platform-wide operational health across Real Estate Professionals,
          property listings and Property Service Professionals.
        </p>
      </section>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      {!data ? (
        <p className="text-sm text-muted">Loading marketplace…</p>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Real Estate Professionals
              </p>
              <p className="mt-3 text-3xl font-semibold text-forest">
                {data.professionals.total}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-warm-white p-3">
                  <p className="text-muted">Verified</p>
                  <p className="mt-1 font-semibold text-forest">
                    {data.professionals.verified}
                  </p>
                </div>
                <div className="rounded-xl bg-warm-white p-3">
                  <p className="text-muted">Pending</p>
                  <p className="mt-1 font-semibold text-forest">
                    {data.professionals.pendingVerification}
                  </p>
                </div>
              </div>
              <Link
                className="mt-5 inline-flex text-sm font-semibold text-teal"
                href="/platform-admin/professionals"
              >
                Open professionals →
              </Link>
            </div>

            <div className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Property listings
              </p>
              <p className="mt-3 text-3xl font-semibold text-forest">
                {data.listings.total}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-warm-white p-3">
                  <p className="text-muted">Live & verified</p>
                  <p className="mt-1 font-semibold text-forest">
                    {data.listings.publishedAndVerified}
                  </p>
                </div>
                <div className="rounded-xl bg-warm-white p-3">
                  <p className="text-muted">Awaiting review</p>
                  <p className="mt-1 font-semibold text-forest">
                    {data.listings.pendingVerification}
                  </p>
                </div>
              </div>
              <Link
                className="mt-5 inline-flex text-sm font-semibold text-teal"
                href="/platform-admin/listings"
              >
                Open listings →
              </Link>
            </div>

            <div className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Service Professionals
              </p>
              <p className="mt-3 text-3xl font-semibold text-forest">
                {data.providers.total}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-warm-white p-3">
                  <p className="text-muted">Verified</p>
                  <p className="mt-1 font-semibold text-forest">
                    {data.providers.verified}
                  </p>
                </div>
                <div className="rounded-xl bg-warm-white p-3">
                  <p className="text-muted">Suspended</p>
                  <p className="mt-1 font-semibold text-forest">
                    {data.providers.suspended}
                  </p>
                </div>
              </div>
              <Link
                className="mt-5 inline-flex text-sm font-semibold text-teal"
                href="/platform-admin/service-providers"
              >
                Open providers →
              </Link>
            </div>
          </section>

          <section className="rounded-2xl border border-hairline bg-forest-deep p-6 text-white shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-soft">
              Trust operations
            </p>
            <h3 className="mt-2 text-xl font-semibold">
              Verification queue
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">
              Review pending listing and professional trust decisions from one
              control center. Service Provider identity verification remains in
              its dedicated evidence-review workspace.
            </p>
            <Link
              className="mt-5 inline-flex rounded-xl bg-gold px-4 py-2.5 text-sm font-semibold text-forest-deep"
              href="/platform-admin/verification"
            >
              Open verification queue
            </Link>
          </section>
        </>
      )}
    </div>
  );
}

export default function PlatformAdminMarketplacePage() {
  return (
    <PlatformAdminShell>
      <MarketplaceContent />
    </PlatformAdminShell>
  );
}
