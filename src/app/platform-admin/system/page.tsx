"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type SystemResponse = {
  runtime: {
    status: "HEALTHY" | "UNHEALTHY";
    timestamp: string;
    application: {
      status: string;
    };
    database: {
      status: string;
      latencyMs: number;
      error?: string;
    };
    providers: Array<{
      name: string;
      readiness:
        | "CONFIGURED"
        | "TEST_MODE"
        | "DEFERRED"
        | "UNCONFIGURED";
      detail: string;
    }>;
  };
  operations: {
    jobsByStatus: Record<string, number>;
    failedJobs: Array<{
      id: string;
      organisationId: string | null;
      type: string;
      attempts: number;
      maxAttempts: number;
      lastError: string | null;
      runAt: string;
    }>;
    notificationFailureCount: number;
    billingWebhookIncidents: Array<{
      id: string;
      providerKey: string;
      eventType: string;
      status: string;
      failureReason: string | null;
      receivedAt: string;
    }>;
    email: {
      provider: string;
      configured: boolean;
      recentFailureCount: number;
    };
  };
};

function readinessTone(readiness: string) {
  switch (readiness) {
    case "CONFIGURED":
      return "bg-teal/10 text-teal";
    case "TEST_MODE":
      return "bg-gold/15 text-forest";
    case "DEFERRED":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-red-50 text-red-800";
  }
}

function SystemContent() {
  const [data, setData] = useState<SystemResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/platform-admin/system", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load system health.",
          );
        }

        return body as SystemResponse;
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
            : "Unable to load system health.",
        );
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="grid gap-7">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            Infrastructure & reliability
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-forest">
            System Health
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Secret-free runtime readiness, database health, provider
            availability, background jobs and incident visibility.
          </p>
        </div>

        <Link
          className="rounded-xl border border-hairline px-4 py-2.5 text-sm font-semibold text-forest"
          href="/platform-admin/health"
        >
          Operations workspace
        </Link>
      </section>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      {!data ? (
        <p className="text-sm text-muted">Loading system health…</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Platform
              </p>
              <p className="mt-2 text-xl font-semibold text-forest">
                {data.runtime.status}
              </p>
            </div>

            <div className="rounded-xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Database
              </p>
              <p className="mt-2 text-xl font-semibold text-forest">
                {data.runtime.database.status}
              </p>
              <p className="mt-1 text-xs text-muted">
                {data.runtime.database.latencyMs} ms
              </p>
            </div>

            <div className="rounded-xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Failed jobs
              </p>
              <p className="mt-2 text-xl font-semibold text-forest">
                {data.operations.failedJobs.length}
              </p>
            </div>

            <div className="rounded-xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Notification failures
              </p>
              <p className="mt-2 text-xl font-semibold text-forest">
                {data.operations.notificationFailureCount}
              </p>
            </div>

            <div className="rounded-xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Billing incidents
              </p>
              <p className="mt-2 text-xl font-semibold text-forest">
                {data.operations.billingWebhookIncidents.length}
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-hairline bg-white shadow-card">
            <div className="border-b border-hairline px-5 py-4">
              <h3 className="font-semibold text-forest">
                Runtime provider readiness
              </h3>
              <p className="mt-1 text-xs text-muted">
                Configuration state only. Credentials, tokens, endpoints and
                secret values are never returned here.
              </p>
            </div>

            <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
              {data.runtime.providers.map((provider) => (
                <div
                  className="rounded-xl border border-hairline p-4"
                  key={provider.name}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-forest">
                      {provider.name}
                    </p>

                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${readinessTone(
                        provider.readiness,
                      )}`}
                    >
                      {provider.readiness.replaceAll("_", " ")}
                    </span>
                  </div>

                  <p className="mt-3 text-xs leading-5 text-muted">
                    {provider.detail}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
              <h3 className="font-semibold text-forest">
                Background jobs
              </h3>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                {Object.entries(data.operations.jobsByStatus).map(
                  ([status, count]) => (
                    <div
                      className="rounded-xl bg-warm-white p-3"
                      key={status}
                    >
                      <dt className="text-xs text-muted">
                        {status.replaceAll("_", " ")}
                      </dt>
                      <dd className="mt-1 text-xl font-semibold text-forest">
                        {count}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </div>

            <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
              <h3 className="font-semibold text-forest">
                Communications transport
              </h3>

              <dl className="mt-4 grid gap-3 text-sm">
                <div className="rounded-xl bg-warm-white p-3">
                  <dt className="text-xs text-muted">Email provider</dt>
                  <dd className="mt-1 font-semibold text-forest">
                    {data.operations.email.provider}
                  </dd>
                </div>

                <div className="rounded-xl bg-warm-white p-3">
                  <dt className="text-xs text-muted">Configuration</dt>
                  <dd className="mt-1 font-semibold text-forest">
                    {data.operations.email.configured
                      ? "CONFIGURED"
                      : "TEST MODE"}
                  </dd>
                </div>

                <div className="rounded-xl bg-warm-white p-3">
                  <dt className="text-xs text-muted">
                    Recent email job failures
                  </dt>
                  <dd className="mt-1 font-semibold text-forest">
                    {data.operations.email.recentFailureCount}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="rounded-2xl border border-hairline bg-forest-deep p-6 text-white shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-soft">
              Security boundary
            </p>
            <h3 className="mt-2 text-lg font-semibold">
              No runtime secrets are displayed
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">
              This console reports readiness and operational status only. API
              keys, tokens, provider credentials, storage names and sensitive
              tenant content remain server-side.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

export default function PlatformAdminSystemPage() {
  return (
    <PlatformAdminShell>
      <SystemContent />
    </PlatformAdminShell>
  );
}
