"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Receipt = {
  receiptNumber: string;
  amountMinor: string;
  currencyCode: string;
  method: string;
  paidAt: string;
  issuedAt: string;
  status: string;
  tenantOrganisation: { tenant: { legalName: string; preferredName: string | null } };
  lease: { referenceNumber: string };
  property: { name: string };
  unit: { name: string } | null;
  payment: { id: string; allocations: Array<{ id: string; amountMinor: string; rentObligation: { dueDate: string; periodStart: string; periodEnd: string } }> };
};

export function ReceiptDetail({ receiptId }: { receiptId: string }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view this receipt."), 0);
      return () => clearTimeout(timer);
    }
    fetch(`/api/receipts/${receiptId}`, { headers: { "x-organisation-id": organisationId } })
      .then(async (response) => response.ok ? setReceipt(await response.json()) : setError((await response.json()).error?.message ?? "Unable to load receipt."));
  }, [receiptId]);
  async function downloadPdf() {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation to view this receipt.");
    setPdfBusy(true);
    try {
      const response = await fetch(`/api/receipts/${receiptId}/pdf`, { method: "POST", headers: { "x-organisation-id": organisationId } });
      const body = await response.json();
      if (!response.ok) return setError(body.error?.message ?? "Unable to generate the receipt PDF.");
      setPdfUrl(body.downloadUrl);
    } finally {
      setPdfBusy(false);
    }
  }
  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</p>;
  if (!receipt) return <p className="rounded-xl border bg-white p-6 text-slate-600">Loading receipt...</p>;
  const money = (value: string) => new Intl.NumberFormat("en-GH", { style: "currency", currency: receipt.currencyCode }).format(Number(value) / 100);
  const date = (value: string) => new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(value));
  return <article className="mx-auto max-w-3xl rounded-2xl border bg-white p-6 shadow-sm sm:p-10"><header className="flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row"><div><p className="text-sm font-semibold text-emerald-700">PROPERTYOS RECEIPT</p><h1 className="mt-1 text-3xl font-semibold">{receipt.receiptNumber}</h1></div><div className="flex items-start gap-2"><span className="self-start rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{receipt.status}</span></div></header><p className="mt-8 text-4xl font-semibold">{money(receipt.amountMinor)}</p><dl className="mt-8 grid gap-5 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Tenant</dt><dd className="mt-1 font-medium">{receipt.tenantOrganisation.tenant.preferredName || receipt.tenantOrganisation.tenant.legalName}</dd></div><div><dt className="text-slate-500">Lease</dt><dd className="mt-1 font-medium">{receipt.lease.referenceNumber}</dd></div><div><dt className="text-slate-500">Property/unit</dt><dd className="mt-1 font-medium">{receipt.property.name}{receipt.unit ? ` · ${receipt.unit.name}` : ""}</dd></div><div><dt className="text-slate-500">Method</dt><dd className="mt-1 font-medium">{receipt.method.replaceAll("_", " ")}</dd></div><div><dt className="text-slate-500">Payment date</dt><dd className="mt-1 font-medium">{date(receipt.paidAt)}</dd></div><div><dt className="text-slate-500">Issued</dt><dd className="mt-1 font-medium">{date(receipt.issuedAt)}</dd></div></dl><section className="mt-8"><h2 className="font-semibold">Related rent obligations</h2>{receipt.payment.allocations.length ? <div className="mt-3 divide-y rounded-xl border">{receipt.payment.allocations.map((allocation) => <div className="flex justify-between p-4" key={allocation.id}><span>Due {date(allocation.rentObligation.dueDate)}</span><strong>{money(allocation.amountMinor)}</strong></div>)}</div> : <p className="mt-3 text-sm text-slate-500">No obligation allocation; amount retained as overpayment.</p>}</section><div className="mt-8 flex flex-wrap items-center gap-4"><Link className="font-semibold text-emerald-700" href={`/payments/${receipt.payment.id}`}>View payment record →</Link>{pdfUrl ? <a className="rounded-lg border px-4 py-2 text-sm font-semibold" href={pdfUrl} rel="noreferrer" target="_blank">Open PDF receipt</a> : <button className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-500" disabled={pdfBusy} onClick={() => void downloadPdf()}>{pdfBusy ? "Generating..." : "Get PDF receipt"}</button>}</div></article>;
}
