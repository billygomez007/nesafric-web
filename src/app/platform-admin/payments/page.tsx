"use client";

import { FormEvent, useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type PaymentRow = {
  id: string;
  organisationId: string;
  internalReference: string;
  amountMinor: string;
  currencyCode: string;
  method: string;
  source: string;
  status: string;
  paidAt: string;
  externalReference: string;
  providerKey: string | null;
  providerTransactionRef: string | null;
  reconciliationStatus: string;
  failureReason: string | null;
  confirmedAt: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
  organisation: {
    id: string;
    name: string;
  };
  _count: {
    reconciliationEvents: number;
    ledgerEntries: number;
  };
};

type PaymentResponse = {
  summary: {
    total: number;
    failed: number;
    reconciliationExceptions: number;
    byStatus: Record<string, number>;
    byReconciliationStatus: Record<string, number>;
  };
  payments: PaymentRow[];
};

type ReconciliationRow = {
  id: string;
  organisationId: string;
  paymentId: string | null;
  securityDepositId: string | null;
  providerKey: string;
  eventKey: string;
  transactionRef: string | null;
  status: string;
  receivedAt: string;
  processedAt: string | null;
  organisation: {
    id: string;
    name: string;
  };
};

const PAYMENT_STATUSES = [
  "",
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REVERSED",
];

const RECONCILIATION_STATUSES = [
  "",
  "UNMATCHED",
  "PENDING",
  "MATCHED",
  "MISMATCHED",
  "DUPLICATE",
];

function formatMoney(amountMinor: string, currency: string) {
  const amount = Number(amountMinor) / 100;

  try {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function PaymentsContent() {
  const [data, setData] = useState<PaymentResponse | null>(null);
  const [reconciliation, setReconciliation] = useState<
    ReconciliationRow[]
  >([]);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [status, setStatus] = useState("");
  const [activeStatus, setActiveStatus] = useState("");
  const [reconciliationStatus, setReconciliationStatus] = useState("");
  const [activeReconciliationStatus, setActiveReconciliationStatus] =
    useState("");
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

    if (activeReconciliationStatus) {
      params.set(
        "reconciliationStatus",
        activeReconciliationStatus,
      );
    }

    Promise.all([
      fetch(`/api/platform-admin/payments?${params.toString()}`, {
        signal: controller.signal,
      }).then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load payments.",
          );
        }

        return body as PaymentResponse;
      }),
      fetch(
        `/api/platform-admin/payments/reconciliation?take=50${
          activeReconciliationStatus
            ? `&status=${encodeURIComponent(activeReconciliationStatus)}`
            : ""
        }`,
        { signal: controller.signal },
      ).then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ??
              "Unable to load reconciliation events.",
          );
        }

        return body as ReconciliationRow[];
      }),
    ])
      .then(([paymentBody, reconciliationBody]) => {
        setData(paymentBody);
        setReconciliation(reconciliationBody);
        setError("");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load finance operations.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    activeSearch,
    activeStatus,
    activeReconciliationStatus,
  ]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setActiveSearch(search);
    setActiveStatus(status);
    setActiveReconciliationStatus(reconciliationStatus);
  }

  return (
    <div className="grid gap-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          Finance operations
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-forest">
          Payments & Reconciliation
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Platform-wide operational visibility into payment status,
          provider transactions and reconciliation exceptions.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total payments", data?.summary.total ?? 0],
          ["Succeeded", data?.summary.byStatus.SUCCEEDED ?? 0],
          ["Pending", data?.summary.byStatus.PENDING ?? 0],
          ["Failed", data?.summary.failed ?? 0],
          [
            "Reconciliation exceptions",
            data?.summary.reconciliationExceptions ?? 0,
          ],
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
        className="grid gap-3 rounded-xl border border-hairline bg-white p-4 shadow-card xl:grid-cols-[1fr_190px_210px_auto_auto]"
        onSubmit={submit}
      >
        <input
          className="rounded-lg border border-hairline px-4 py-2.5 text-sm outline-none focus:border-teal"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Organisation or transaction reference"
          value={search}
        />

        <select
          className="rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          {PAYMENT_STATUSES.map((entry) => (
            <option key={entry || "ALL"} value={entry}>
              {entry || "All payment statuses"}
            </option>
          ))}
        </select>

        <select
          className="rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm"
          onChange={(event) =>
            setReconciliationStatus(event.target.value)
          }
          value={reconciliationStatus}
        >
          {RECONCILIATION_STATUSES.map((entry) => (
            <option key={entry || "ALL"} value={entry}>
              {entry
                ? entry.replaceAll("_", " ")
                : "All reconciliation"}
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
            setReconciliationStatus("");
            setActiveSearch("");
            setActiveStatus("");
            setActiveReconciliationStatus("");
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
        <p className="text-sm text-muted">Loading payments…</p>
      ) : !data?.payments.length ? (
        <div className="rounded-xl border border-hairline bg-white p-8 text-center shadow-card">
          <h3 className="font-semibold text-forest">
            No payments found
          </h3>
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
          <div className="border-b border-hairline px-5 py-4">
            <h3 className="font-semibold text-forest">
              Recent payments
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left text-sm">
              <thead className="border-b border-hairline bg-warm-white text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-4">Organisation</th>
                  <th className="px-5 py-4">Reference</th>
                  <th className="px-5 py-4">Amount</th>
                  <th className="px-5 py-4">Method</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Reconciliation</th>
                  <th className="px-5 py-4">Provider</th>
                  <th className="px-5 py-4">Paid</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-hairline">
                {data.payments.map((payment) => (
                  <tr
                    className="align-top hover:bg-warm-white/60"
                    key={payment.id}
                  >
                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {payment.organisation.name}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-muted">
                        {payment.organisation.id.slice(0, 8)}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <p className="font-mono text-xs text-forest">
                        {payment.internalReference}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {payment.externalReference}
                      </p>
                    </td>

                    <td className="px-5 py-4 font-semibold text-forest">
                      {formatMoney(
                        payment.amountMinor,
                        payment.currencyCode,
                      )}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {payment.method.replaceAll("_", " ")}
                      <br />
                      {payment.source}
                    </td>

                    <td className="px-5 py-4">
                      <span className="text-xs font-semibold text-forest">
                        {payment.status}
                      </span>
                      {payment.failureReason && (
                        <p className="mt-1 max-w-xs text-xs text-red-700">
                          {payment.failureReason}
                        </p>
                      )}
                    </td>

                    <td className="px-5 py-4 text-xs font-semibold text-forest">
                      {payment.reconciliationStatus}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {payment.providerKey ?? "Manual"}
                      {payment.providerTransactionRef && (
                        <p className="mt-1 font-mono text-[10px]">
                          {payment.providerTransactionRef}
                        </p>
                      )}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {new Date(payment.paidAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
        <div className="border-b border-hairline px-5 py-4">
          <h3 className="font-semibold text-forest">
            Reconciliation events
          </h3>
          <p className="mt-1 text-xs text-muted">
            Provider webhook reconciliation ledger. Payload hashes are not
            exposed in this console.
          </p>
        </div>

        {!reconciliation.length ? (
          <p className="p-6 text-sm text-muted">
            No reconciliation events found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] text-left text-sm">
              <thead className="border-b border-hairline bg-warm-white text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-4">Organisation</th>
                  <th className="px-5 py-4">Provider</th>
                  <th className="px-5 py-4">Event</th>
                  <th className="px-5 py-4">Transaction</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Received</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-hairline">
                {reconciliation.map((event) => (
                  <tr key={event.id}>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {event.organisation.name}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-muted">
                        {event.organisation.id.slice(0, 8)}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-xs text-muted">
                      {event.providerKey}
                    </td>
                    <td className="px-5 py-4 font-mono text-xs">
                      {event.eventKey}
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-muted">
                      {event.transactionRef ?? "—"}
                    </td>
                    <td className="px-5 py-4 text-xs font-semibold text-forest">
                      {event.status}
                    </td>
                    <td className="px-5 py-4 text-xs text-muted">
                      {new Date(event.receivedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function PlatformAdminPaymentsPage() {
  return (
    <PlatformAdminShell>
      <PaymentsContent />
    </PlatformAdminShell>
  );
}
