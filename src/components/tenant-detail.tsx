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
  tenant: {
    legalName: string;
    preferredName: string | null;
  };
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
  lease: {
    id: string;
    referenceNumber: string;
  } | null;
};

const DEVELOPMENT_PREVIEW_TENANT: TenantDetailData = {
  id: "preview-ama",
  email: "ama@example.com",
  phone: "+233 24 000 0001",
  addressLine1: "14 Ridge Road",
  city: "Accra",
  notes: "Primary tenant for The Ridge Apartments.",
  communicationEmailAllowed: true,
  communicationSmsAllowed: true,
  communicationWhatsappAllowed: true,
  communicationInAppAllowed: true,
  tenant: {
    legalName: "Ama Mensah",
    preferredName: "Ama",
  },
  leaseParties: [
    {
      id: "preview-party-1",
      role: "TENANT",
      lease: {
        id: "preview-lease-1",
        referenceNumber: "LEASE-001",
        status: "ACTIVE",
        startDate: "2026-01-01T00:00:00.000Z",
        endDate: "2026-12-31T00:00:00.000Z",
        property: { name: "The Ridge Apartments" },
        unit: { name: "A2" },
      },
    },
  ],
};

function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "Ongoing";
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-hairline bg-white shadow-[0_8px_28px_rgba(16,45,42,0.035)]">
      <div className="border-b border-hairline px-5 py-4 sm:px-6">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
        )}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

export function TenantDetail({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<TenantDetailData | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState("");
  const [preferenceSuccess, setPreferenceSuccess] = useState("");
  const [savingPreferences, setSavingPreferences] = useState(false);

  useEffect(() => {
    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );

    if (!organisationId) {
      if (process.env.NODE_ENV !== "production") {
        const timer = setTimeout(() => {
          setTenant(DEVELOPMENT_PREVIEW_TENANT);
          setNotifications([]);
        }, 0);

        return () => clearTimeout(timer);
      }

      const timer = setTimeout(
        () => setError("Choose an organisation to view this tenant."),
        0,
      );

      return () => clearTimeout(timer);
    }

    Promise.all([
      fetch(`/api/tenants/${tenantId}`, {
        headers: { "x-organisation-id": organisationId },
      }),
      fetch("/api/notifications", {
        headers: { "x-organisation-id": organisationId },
      }),
    ])
      .then(async ([tenantResponse, notificationResponse]) => {
        if (!tenantResponse.ok) {
          throw new Error(
            (await tenantResponse.json()).error?.message ??
              "Unable to load tenant.",
          );
        }

        const detail = await tenantResponse.json();
        setTenant(detail);

        if (notificationResponse.ok) {
          const history: Notification[] = await notificationResponse.json();

          setNotifications(
            history.filter(
              (notification) => notification.tenantOrganisationId === detail.id,
            ),
          );
        }
      })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Unable to load tenant.",
        ),
      );
  }, [tenantId]);

  async function updatePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenant) return;

    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );

    if (!organisationId) {
      if (process.env.NODE_ENV !== "production") {
        setPreferenceSuccess(
          "Preview only — communication preferences are not persisted locally.",
        );
        return;
      }

      setError("Choose an organisation to update communication preferences.");
      return;
    }

    const form = new FormData(event.currentTarget);

    const preferences = {
      communicationInAppAllowed: form.get("communicationInAppAllowed") === "on",
      communicationEmailAllowed: form.get("communicationEmailAllowed") === "on",
      communicationSmsAllowed: form.get("communicationSmsAllowed") === "on",
      communicationWhatsappAllowed:
        form.get("communicationWhatsappAllowed") === "on",
    };

    setSavingPreferences(true);
    setPreferenceSuccess("");

    const response = await fetch(
      `/api/tenants/${tenant.id}/communication-preferences`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-organisation-id": organisationId,
        },
        body: JSON.stringify(preferences),
      },
    );

    if (!response.ok) {
      setError(
        (await response.json()).error?.message ??
          "Unable to update communication preferences.",
      );
    } else {
      setTenant({ ...tenant, ...(await response.json()) });
      setError("");
      setPreferenceSuccess("Communication preferences updated.");
    }

    setSavingPreferences(false);
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
        {error}
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="h-64 animate-pulse rounded-2xl border border-hairline bg-white" />
    );
  }

  const channels = [
    ["In-app", tenant.communicationInAppAllowed],
    ["Email", tenant.communicationEmailAllowed],
    ["SMS", tenant.communicationSmsAllowed],
    ["WhatsApp", tenant.communicationWhatsappAllowed],
  ] as const;

  const displayName = tenant.tenant.preferredName || tenant.tenant.legalName;

  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border border-hairline bg-white p-5 shadow-[0_8px_28px_rgba(16,45,42,0.035)] sm:p-6">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-teal/10 text-base font-semibold text-teal">
              {initials(tenant.tenant.legalName)}
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal">
                Tenant profile
              </p>

              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-ink">
                {displayName}
              </h2>

              {tenant.tenant.preferredName && (
                <p className="mt-1 text-sm text-muted">
                  {tenant.tenant.legalName}
                </p>
              )}
            </div>
          </div>

          <Link
            className="self-start rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition hover:bg-surface hover:text-ink"
            href="/tenants"
          >
            Back to tenants
          </Link>
        </div>

        <dl className="mt-6 grid gap-5 border-t border-hairline pt-5 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">
              Email
            </dt>
            <dd className="mt-1.5 font-medium text-ink">
              {tenant.email || "Not provided"}
            </dd>
          </div>

          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">
              Phone
            </dt>
            <dd className="mt-1.5 font-medium text-ink">
              {tenant.phone || "Not provided"}
            </dd>
          </div>

          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">
              Address
            </dt>
            <dd className="mt-1.5 font-medium text-ink">
              {[tenant.addressLine1, tenant.city].filter(Boolean).join(", ") ||
                "Not provided"}
            </dd>
          </div>

          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">
              Active channels
            </dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {channels.map(([label, enabled]) => (
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                    enabled ? "bg-teal/10 text-teal" : "bg-surface text-muted"
                  }`}
                  key={label}
                >
                  {label}
                </span>
              ))}
            </dd>
          </div>
        </dl>

        {tenant.notes && (
          <div className="mt-5 rounded-xl bg-surface p-4 text-sm leading-6 text-muted">
            {tenant.notes}
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section
          description="Choose how this tenant can receive future communication."
          title="Communication preferences"
        >
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={updatePreferences}
          >
            {[
              [
                "communicationInAppAllowed",
                "In-app",
                tenant.communicationInAppAllowed,
              ],
              [
                "communicationEmailAllowed",
                "Email",
                tenant.communicationEmailAllowed,
              ],
              [
                "communicationSmsAllowed",
                "SMS",
                tenant.communicationSmsAllowed,
              ],
              [
                "communicationWhatsappAllowed",
                "WhatsApp",
                tenant.communicationWhatsappAllowed,
              ],
            ].map(([name, label, enabled]) => (
              <label
                className="flex items-center gap-3 rounded-xl border border-hairline bg-warm-white p-4 text-sm font-medium text-ink"
                key={String(name)}
              >
                <input
                  className="h-4 w-4 accent-teal"
                  defaultChecked={Boolean(enabled)}
                  name={String(name)}
                  type="checkbox"
                />
                {label}
              </label>
            ))}

            <div className="sm:col-span-2">
              <button
                className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
                disabled={savingPreferences}
                type="submit"
              >
                {savingPreferences ? "Saving..." : "Save preferences"}
              </button>
            </div>
          </form>

          {preferenceSuccess && (
            <p className="mt-4 rounded-xl bg-teal/10 p-3 text-sm text-forest">
              {preferenceSuccess}
            </p>
          )}
        </Section>

        <Section
          description="Current and historical leases linked to this tenant."
          title="Lease history"
        >
          {tenant.leaseParties.length ? (
            <div className="grid gap-3">
              {tenant.leaseParties.map(({ id, role, lease }) => (
                <Link
                  className="grid gap-3 rounded-xl border border-hairline bg-warm-white p-4 transition hover:border-teal/25 sm:grid-cols-[1fr_auto]"
                  href={`/leases/${lease.id}`}
                  key={id}
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {lease.referenceNumber}
                    </p>

                    <p className="mt-1 text-xs text-muted">
                      {lease.property.name}
                      {lease.unit ? ` · ${lease.unit.name}` : ""} ·{" "}
                      {role.toLowerCase()}
                    </p>

                    <p className="mt-2 text-xs text-muted">
                      {date(lease.startDate)} – {date(lease.endDate)}
                    </p>
                  </div>

                  <span className="self-start rounded-full bg-teal/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal">
                    {lease.status}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-hairline p-6 text-center text-sm text-muted">
              No leases are linked to this tenant.
            </div>
          )}
        </Section>
      </div>

      <Section
        description="Reminder and communication activity for this tenant."
        title="Notification history"
      >
        {notifications.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th className="pb-3">Event</th>
                  <th className="pb-3">Lease</th>
                  <th className="pb-3">Channel</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Created</th>
                  <th className="pb-3">Read</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-hairline">
                {notifications.map((notification) => (
                  <tr key={notification.id}>
                    <td className="py-3 font-medium text-ink">
                      {notification.eventType.replaceAll("_", " ")}
                    </td>
                    <td className="py-3 text-muted">
                      {notification.lease?.referenceNumber || "—"}
                    </td>
                    <td className="py-3 text-muted">{notification.channel}</td>
                    <td className="py-3 text-muted">{notification.status}</td>
                    <td className="py-3 text-muted">
                      {date(notification.createdAt)}
                    </td>
                    <td className="py-3 text-muted">
                      {notification.readAt
                        ? date(notification.readAt)
                        : "Unread"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-hairline p-6 text-center text-sm text-muted">
            No reminders or notifications for this tenant.
          </div>
        )}
      </Section>

      <Section
        description="Rent and other payments associated with this tenant."
        title="Payment history"
      >
        <ScopedPaymentHistory scope="tenants" id={tenant.id} />
      </Section>

      <Section
        description="Maintenance requests associated with this tenant."
        title="Maintenance history"
      >
        <ScopedMaintenanceHistory scope="tenants" id={tenant.id} />
      </Section>
    </div>
  );
}
