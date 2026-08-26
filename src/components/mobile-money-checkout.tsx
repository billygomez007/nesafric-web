"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Provider = { key: string; displayName: string; supportedMethods: string[]; available: boolean };
type IntentStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
type Intent = { id: string; status: IntentStatus; amountMinor: string; currencyCode: string };

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

function money(value: string, currency: string) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(Number(value) / 100);
}

/**
 * Mobile-first checkout for a tenant paying rent via Ghanaian mobile money. Initiating checkout
 * never marks the payment as successful — it only starts an asynchronous provider request. This
 * component polls the payment intent until the *provider's verified webhook* reconciles it to a
 * terminal SUCCEEDED/FAILED/CANCELLED state; a returned/redirected browser tab is never treated
 * as a success signal on its own.
 */
export function MobileMoneyCheckout({
  leaseId,
  tenantOrganisationId,
  currencyCode,
  defaultAmountMinor,
}: {
  leaseId: string;
  tenantOrganisationId: string;
  currencyCode: string;
  defaultAmountMinor?: string;
}) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [providerKey, setProviderKey] = useState("");
  const [msisdn, setMsisdn] = useState("");
  const [amountMinor, setAmountMinor] = useState(defaultAmountMinor ?? "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/payment-providers").then(async (response) => {
      if (!response.ok) return;
      const all: Provider[] = await response.json();
      const mobileMoney = all.filter((provider) => provider.supportedMethods.includes("MOBILE_MONEY"));
      setProviders(mobileMoney);
      setProviderKey((current) => current || mobileMoney.find((provider) => provider.available)?.key || mobileMoney[0]?.key || "");
    });
  }, []);

  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  function pollIntent(intentId: string, organisationId: string) {
    const startedAt = Date.now();
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        return;
      }
      const response = await fetch(`/api/payment-intents/${intentId}`, { headers: { "x-organisation-id": organisationId } });
      if (!response.ok) return;
      const updated: Intent = await response.json();
      setIntent(updated);
      if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(updated.status) && pollTimer.current) clearInterval(pollTimer.current);
    }, POLL_INTERVAL_MS);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation before paying.");
    if (!providerKey) return setError("Choose a mobile money network.");
    setSubmitting(true);
    setError("");
    const response = await fetch(`/api/tenants/${tenantOrganisationId}/payments/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-organisation-id": organisationId },
      body: JSON.stringify({
        leaseId,
        amountMinor,
        currencyCode,
        method: "MOBILE_MONEY",
        providerKey,
        idempotencyKey: crypto.randomUUID(),
        metadata: msisdn ? { msisdn } : undefined,
      }),
    });
    setSubmitting(false);
    if (!response.ok) {
      setError((await response.json()).error?.message ?? "Unable to start checkout.");
      return;
    }
    const created: Intent = await response.json();
    setIntent(created);
    pollIntent(created.id, organisationId);
  }

  if (intent) {
    const label = {
      PENDING: "Waiting for the provider to start your request...",
      PROCESSING: "Approve the payment prompt on your phone to complete this transaction.",
      SUCCEEDED: "Payment confirmed. Thank you!",
      FAILED: "The payment could not be completed. You can try again.",
      CANCELLED: "The payment was cancelled before it completed.",
    }[intent.status];
    return <div className="grid gap-4 rounded-2xl border bg-white p-6 text-center shadow-sm">
      <p className="text-sm text-slate-500">{money(intent.amountMinor, intent.currencyCode)}</p>
      <p className={`text-lg font-semibold ${intent.status === "SUCCEEDED" ? "text-emerald-700" : intent.status === "FAILED" || intent.status === "CANCELLED" ? "text-red-700" : "text-slate-800"}`}>{label}</p>
      {(intent.status === "FAILED" || intent.status === "CANCELLED") && <button className="rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => setIntent(null)}>Try again</button>}
    </div>;
  }

  return <form className="grid gap-4 rounded-2xl border bg-white p-6 shadow-sm" onSubmit={submit}>
    <h2 className="text-lg font-semibold">Pay with Mobile Money</h2>
    <label className="text-sm font-medium">Network
      <select className="mt-1 w-full rounded-lg border p-3" disabled={!providers} onChange={(event) => setProviderKey(event.target.value)} required value={providerKey}>
        {!providers && <option value="">Loading networks...</option>}
        {providers?.map((provider) => <option disabled={!provider.available} key={provider.key} value={provider.key}>{provider.displayName}{!provider.available ? " (temporarily unavailable)" : ""}</option>)}
      </select>
    </label>
    <label className="text-sm font-medium">Mobile money number
      <input className="mt-1 w-full rounded-lg border p-3" inputMode="tel" onChange={(event) => setMsisdn(event.target.value)} placeholder="0244000000" required value={msisdn} />
    </label>
    <label className="text-sm font-medium">Amount ({currencyCode})
      <input className="mt-1 w-full rounded-lg border p-3" inputMode="numeric" min="1" onChange={(event) => setAmountMinor(event.target.value)} required value={amountMinor} />
    </label>
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <button className="rounded-lg bg-emerald-700 p-3 font-semibold text-white disabled:opacity-50" disabled={submitting || !providerKey}>{submitting ? "Sending prompt..." : "Pay now"}</button>
    <p className="text-xs text-slate-500">We will only mark this as paid once your network confirms the transaction. This can take a moment after you approve the prompt on your phone.</p>
  </form>;
}
