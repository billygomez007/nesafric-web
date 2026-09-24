"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type AIOperations = {
  summary: {
    totalEmployees: number;
    activeEmployees: number;
    openHandoffs: number;
    openEscalations: number;
    criticalEscalations: number;
  };
  employees: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
    scope: string;
    providerKey: string | null;
    modelKey: string | null;
    organisation: {
      id: string;
      name: string;
    } | null;
    marketplaceProfessional: {
      id: string;
      displayName: string;
      type: string;
    } | null;
    _count: {
      activities: number;
      handoffs: number;
      conversations: number;
    };
  }>;
  recentActivities: Array<{
    id: string;
    type: string;
    status: string;
    actionKey: string | null;
    policyDecision: string | null;
    reason: string;
    failureCode: string | null;
    failureMessage: string | null;
    createdAt: string;
    aiEmployee: {
      id: string;
      name: string;
      role: string;
    };
    organisation: {
      id: string;
      name: string;
    } | null;
    marketplaceProfessional: {
      id: string;
      displayName: string;
    } | null;
  }>;
  handoffs: Array<{
    id: string;
    reason: string;
    urgency: string;
    status: string;
    contextSummary: string;
    createdAt: string;
    aiEmployee: {
      id: string;
      name: string;
      role: string;
    };
    organisation: {
      id: string;
      name: string;
    } | null;
    marketplaceProfessional: {
      id: string;
      displayName: string;
    } | null;
  }>;
};

function AIOperationsContent() {
  const [data, setData] = useState<AIOperations | null>(null);
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
            body.error?.message ?? "Unable to load AI operations.",
          );
        }

        return body as AIOperations;
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
            : "Unable to load AI operations.",
        );
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="grid gap-7">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            Intelligence operations
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-forest">
            AI Operations
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Platform-wide oversight of AI Employees, activity, human handoffs
            and autonomous-operation escalations.
          </p>
        </div>

        <Link
          className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white"
          href="/platform-admin/ai/escalations"
        >
          Open escalations
        </Link>
      </section>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      {!data ? (
        <p className="text-sm text-muted">Loading AI operations…</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["AI Employees", data.summary.totalEmployees],
              ["Active", data.summary.activeEmployees],
              ["Open handoffs", data.summary.openHandoffs],
              ["Open escalations", data.summary.openEscalations],
              ["Critical escalations", data.summary.criticalEscalations],
            ].map(([label, value]) => (
              <div
                className="rounded-xl border border-hairline bg-white p-4 shadow-card"
                key={String(label)}
              >
                <p className="text-xs uppercase tracking-wider text-muted">
                  {label}
                </p>
                <p className="mt-2 text-2xl font-semibold text-forest">
                  {value}
                </p>
              </div>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
            <div className="border-b border-hairline px-5 py-4">
              <h3 className="font-semibold text-forest">AI Employees</h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="border-b border-hairline bg-warm-white text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-5 py-4">Employee</th>
                    <th className="px-5 py-4">Workspace</th>
                    <th className="px-5 py-4">Role</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Activities</th>
                    <th className="px-5 py-4">Handoffs</th>
                    <th className="px-5 py-4">Conversations</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-hairline">
                  {data.employees.map((employee) => (
                    <tr key={employee.id}>
                      <td className="px-5 py-4 font-semibold text-forest">
                        {employee.name}
                      </td>
                      <td className="px-5 py-4 text-xs text-muted">
                        {employee.organisation?.name ??
                          employee.marketplaceProfessional?.displayName ??
                          "Unknown"}
                      </td>
                      <td className="px-5 py-4 text-xs text-muted">
                        {employee.role.replaceAll("_", " ")}
                      </td>
                      <td className="px-5 py-4 text-xs font-semibold text-forest">
                        {employee.status}
                      </td>
                      <td className="px-5 py-4 text-xs text-muted">
                        {employee._count.activities}
                      </td>
                      <td className="px-5 py-4 text-xs text-muted">
                        {employee._count.handoffs}
                      </td>
                      <td className="px-5 py-4 text-xs text-muted">
                        {employee._count.conversations}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-hairline bg-white shadow-card">
              <div className="border-b border-hairline px-5 py-4">
                <h3 className="font-semibold text-forest">
                  Recent AI activity
                </h3>
              </div>

              <div className="divide-y divide-hairline">
                {data.recentActivities.slice(0, 30).map((activity) => (
                  <div className="p-5" key={activity.id}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="font-semibold text-forest">
                        {activity.aiEmployee.name}
                      </p>
                      <span className="text-xs font-semibold text-muted">
                        {activity.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {activity.organisation?.name ??
                        activity.marketplaceProfessional?.displayName ??
                        "Unknown workspace"}
                    </p>
                    <p className="mt-2 text-sm text-forest">
                      {activity.reason}
                    </p>
                    {activity.failureCode && (
                      <p className="mt-2 text-xs text-red-700">
                        {activity.failureCode}: {activity.failureMessage}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-hairline bg-white shadow-card">
              <div className="border-b border-hairline px-5 py-4">
                <h3 className="font-semibold text-forest">
                  Human handoffs
                </h3>
              </div>

              <div className="divide-y divide-hairline">
                {data.handoffs.slice(0, 30).map((handoff) => (
                  <div className="p-5" key={handoff.id}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="font-semibold text-forest">
                        {handoff.aiEmployee.name}
                      </p>
                      <span className="text-xs font-semibold text-forest">
                        {handoff.urgency}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {handoff.organisation?.name ??
                        handoff.marketplaceProfessional?.displayName ??
                        "Unknown workspace"}
                    </p>
                    <p className="mt-2 text-sm text-forest">
                      {handoff.reason}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function PlatformAdminAIPage() {
  return (
    <PlatformAdminShell>
      <AIOperationsContent />
    </PlatformAdminShell>
  );
}
