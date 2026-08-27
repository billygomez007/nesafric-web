"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ScopedPaymentHistory } from "@/components/scoped-payment-history";
import { ScopedMaintenanceHistory } from "@/components/scoped-maintenance-history";

type TenantDetailData = {
  id: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  notes: string | null;
  communicationEmailAllowed: boolean;
  communicationSmsAllowed: boolean;
  communicationWhatsappAllowed: boolean;
  communicationInAppAllowed: boolean;
  tenant: { legalName: string; preferredName: string | null };
  leaseParties: Array<{
    id: string;
    role: string;
    lease: {
      id: string;
      referenceNumber: string;
      status: string;
      startDate: string;
      endDate: string | null;
      property: { name: string };
      unit: { name: string } | null;
    };
  }>;
};

type Notification = {
  id: string;
  tenantOrganisationId: string | null;
  eventType: string;
  channel: string;
  status: string;
  createdAt: string;
  readAt: string | null;
  lease: { id: string; referenceNumber: string } | null;
};

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(value)) : "Ongoing";
}

export function TenantDetail({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<TenantDetailData | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState("");
  const [preferenceSuccess, setPreferenceSuccess] = useState("");
  const [savingPreferences, setSavingPreferences] = useState(false);

  useEffect(() => {
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) {
      const timer = setTimeout(() => setError("Choose an organisation to view this tenant."), 0);
      return () => clearTimeout(timer);
    }
    Promise.all([
      fetch(`/api/tenants/${tenantId}`, { headers: { "x-organisation-id": organisationId } }),
      fetch("/api/notifications", { headers: { "x-organisation-id": organisationId } }),
    ]).then(async ([tenantResponse, notificationResponse]) => {
      if (!tenantResponse.ok) throw new Error((await tenantResponse.json()).error?.message ?? "Unable to load tenant.");
      const detail = await tenantResponse.json();
      setTenant(detail);
      if (notificationResponse.ok) {
        const history: Notification[] = await notificationResponse.json();
        setNotifications(history.filter((notification) => notification.tenantOrganisationId === detail.id));
      }
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load tenant."));
  }, [tenantId]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</div>;
  if (!tenant) return <div className="rounded-xl border bg-white p-6 text-slate-600">Loading tenant details...</div>;

  const channels = [
    ["In-app", tenant.communicationInAppAllowed],
    ["Email", tenant.communicationEmailAllowed],
    ["SMS", tenant.communicationSmsAllowed],
    ["WhatsApp", tenant.communicationWhatsappAllowed],
  ] as const;

  async function updatePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) return;
    const organisationId = localStorage.getItem("propertyos.activeOrganisationId");
    if (!organisationId) return setError("Choose an organisation to update communication preferences.");
    const form = new FormData(event.currentTarget);
    const preferences = {
      communicationInAppAllowed: form.get("communicationInAppAllowed") === "on",
      communicationEmailAllowed: form.get("communicationEmailAllowed") === "on",
      communicationSmsAllowed: form.get("communicationSmsAllowed") === "on",
      communicationWhatsappAllowed: form.get("communicationWhatsappAllowed") === "on",
    };
    setSavingPreferences(true);
    setPreferenceSuccess("");
    const response = await fetch(`/api/tenants/${tenant.id}/communication-preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-organisation-id": organisationId },
      body: JSON.stringify(preferences),
    });
    if (!response.ok) setError((await response.json()).error?.message ?? "Unable to update communication preferences.");
    else {
      setTenant({ ...tenant, ...await response.json() });
      setError("");
      setPreferenceSuccess("Communication preferences updated.");
    }
    setSavingPreferences(false);
  }

  return <div className="grid gap-6">
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-4 sm:flex-row">
        <div><p className="text-sm font-semibold text-emerald-700">TENANT PROFILE</p><h1 className="mt-1 text-3xl font-semibold">{tenant.tenant.preferredName || tenant.tenant.legalName}</h1>{tenant.tenant.preferredName && <p className="mt-1 text-slate-500">{tenant.tenant.legalName}</p>}</div>
        <Link className="self-start rounded-lg border px-4 py-2 text-sm font-semibold" href="/tenants">Back to tenants</Link>
      </div>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-slate-500">Email</dt><dd className="mt-1 font-medium">{tenant.email || "Not provided"}</dd></div>
        <div><dt className="text-slate-500">Phone</dt><dd className="mt-1 font-medium">{tenant.phone || "Not provided"}</dd></div>
        <div><dt className="text-slate-500">Address</dt><dd className="mt-1 font-medium">{[tenant.addressLine1, tenant.city].filter(Boolean).join(", ") || "Not provided"}</dd></div>
        <div><dt className="text-slate-500">Active channels</dt><dd className="mt-1 flex flex-wrap gap-1">{channels.map(([label, enabled]) => <span className={`rounded-full px-2 py-1 text-xs ${enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`} key={label}>{label}</span>)}</dd></div>
      </dl>
      {tenant.notes && <p className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">{tenant.notes}</p>}
    </section>

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Communication preferences</h2>
      <p className="mt-1 text-sm text-slate-600">Disabled channels are skipped by future reminder delivery.</p>
      <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={updatePreferences}>
        {[
          ["communicationInAppAllowed", "In-app", tenant.communicationInAppAllowed],
          ["communicationEmailAllowed", "Email", tenant.communicationEmailAllowed],
          ["communicationSmsAllowed", "SMS", tenant.communicationSmsAllowed],
          ["communicationWhatsappAllowed", "WhatsApp", tenant.communicationWhatsappAllowed],
        ].map(([name, label, enabled]) => <label className="flex items-center gap-3 rounded-xl border p-4 text-sm font-medium" key={String(name)}><input defaultChecked={Boolean(enabled)} name={String(name)} type="checkbox" />{label}</label>)}
        <div className="sm:col-span-2 lg:col-span-4"><button className="rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600" disabled={savingPreferences}>{savingPreferences ? "Saving..." : "Save preferences"}</button></div>
      </form>
      {preferenceSuccess && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{preferenceSuccess}</p>}
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </section>

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Lease history</h2>
      {tenant.leaseParties.length ? <div className="mt-4 grid gap-3">{tenant.leaseParties.map(({ id, role, lease }) => <Link className="grid gap-2 rounded-xl border p-4 transition hover:border-emerald-500 sm:grid-cols-[1fr_auto]" href={`/leases/${lease.id}`} key={id}><div><p className="font-semibold">{lease.referenceNumber}</p><p className="text-sm text-slate-600">{lease.property.name}{lease.unit ? ` · ${lease.unit.name}` : ""} · {role.toLowerCase()}</p><p className="mt-1 text-sm text-slate-500">{date(lease.startDate)} – {date(lease.endDate)}</p></div><span className="self-start rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{lease.status}</span></Link>)}</div> : <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-slate-500">No leases are linked to this tenant.</p>}
    </section>

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Reminder and notification history</h2>
      {notifications.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-xl text-left text-sm"><thead className="border-b text-slate-500"><tr><th className="py-3">Event</th><th>Lease</th><th>Channel</th><th>Status</th><th>Created</th><th>Read</th></tr></thead><tbody className="divide-y">{notifications.map((notification) => <tr key={notification.id}><td className="py-3 font-medium">{notification.eventType.replaceAll("_", " ")}</td><td>{notification.lease?.referenceNumber || "—"}</td><td>{notification.channel}</td><td>{notification.status}</td><td>{date(notification.createdAt)}</td><td>{notification.readAt ? date(notification.readAt) : "Unread"}</td></tr>)}</tbody></table></div> : <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-slate-500">No reminders or notifications for this tenant.</p>}
    </section>

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Payment history</h2>
      <ScopedPaymentHistory scope="tenants" id={tenant.id} />
    </section>
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Maintenance history</h2>
      <ScopedMaintenanceHistory scope="tenants" id={tenant.id} />
    </section>
  </div>;
}
