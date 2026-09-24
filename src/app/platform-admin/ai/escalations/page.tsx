"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type Escalation = {
  id: string;
  activityId: string;
  status: string;
  level: number;
  reason: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  activity: {
    organisationId: string;
    type: string;
    status: string;
    severity: string;
    conditionKey: string;
    actionKey: string | null;
    autonomyLevel: string | null;
    policyDecision: string;
    reason: string;
    createdAt: string;
    organisation: {
      id: string;
      name: string;
    };
  };
};

type Response = {
  summary: {
    totalEmployees: number;
    activeEmployees: number;
    openHandoffs: number;
    openEscalations: number;
    criticalEscalations: number;
  };
  escalations: Escalation[];
};

function EscalationsContent() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/platform-admin/ai", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load AI escalations.",
          );
        }

        return body as Response;
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
            : "Unable to load AI escalations.",
        );
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="grid gap-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            Intelligence operations
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-forest">
            AI Escalations
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Platform visibility into unresolved autonomous-operation
            escalations. Resolution remains controlled by the owning
            organisation workflow.
          </p>
        </div>

        <Link
          className="rounded-xl border border-hairline px-4 py-2.5 text-sm font-semibold text-forest"
          href="/platform-admin/ai"
        >
          Back to AI Operations
        </Link>
      </section>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      {!data ? (
        <p className="text-sm text-muted">Loading escalations…</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Open escalations
              </p>
              <p className="mt-2 text-3xl font-semibold text-forest">
                {data.summary.openEscalations}
              </p>
            </div>

            <div className="rounded-xl border border-hairline bg-white p-5 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Critical
              </p>
              <p className="mt-2 text-3xl font-semibold text-forest">
                {data.summary.criticalEscalations}
              </p>
            </div>
          </section>

          {!data.escalations.length ? (
            <div className="rounded-xl border border-hairline bg-white p-8 text-center shadow-card">
              <p className="font-semibold text-forest">
                No unresolved AI escalations.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {data.escalations.map((escalation) => (
                <article
                  className="rounded-xl border border-hairline bg-white p-5 shadow-card"
                  key={escalation.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-forest">
                        {escalation.activity.organisation.name}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {escalation.activity.conditionKey}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800">
                        {escalation.activity.severity}
                      </span>
                      <span className="rounded-full bg-warm-white px-2.5 py-1 text-xs font-semibold text-forest">
                        Level {escalation.level}
                      </span>
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-forest">
                    {escalation.reason}
                  </p>

                  <div className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-3">
                    <p>
                      Status:{" "}
                      <span className="font-semibold text-forest">
                        {escalation.status}
                      </span>
                    </p>
                    <p>
                      Decision:{" "}
                      <span className="font-semibold text-forest">
                        {escalation.activity.policyDecision}
                      </span>
                    </p>
                    <p>
                      Created:{" "}
                      {new Date(escalation.createdAt).toLocaleString()}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PlatformAdminAIEscalationsPage() {
  return (
    <PlatformAdminShell>
      <EscalationsContent />
    </PlatformAdminShell>
  );
}
