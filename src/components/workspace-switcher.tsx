"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Workspace = {
  propertyOsOrganisations: Array<{ id: string; name: string }>;
  marketplaceProfessionals: Array<{ id: string; displayName: string; type: string; myRole: string }>;
  serviceProviders: Array<{
    id: string;
    displayName: string;
    type: string;
    verificationStatus: string;
    availabilityStatus: string;
    suspended: boolean;
  }>;
};

/**
 * Workspace switcher — a single identity acting across clearly separate Property Management,
 * Marketplace Professional, and Service Provider workspaces. The collections remain separate;
 * switching changes the active workspace shell, never the signed-in identity.
 */
export function WorkspaceSwitcher({
  current,
}: {
  current: { kind: "propertyos" | "marketplace" | "service_provider"; label: string };
}) {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  function selectOrganisation(organisationId: string) {
    localStorage.setItem("propertyos.activeOrganisationId", organisationId);
    setOpen(false);
    // A full reload guarantees every NesAfric management page (each reads the active organisation from
    // localStorage independently on mount) picks up the newly selected organisation, including
    // when the switch happens while already sitting on /dashboard.
    if (window.location.pathname === "/dashboard") window.location.reload();
    else router.push("/dashboard");
  }

  useEffect(() => {
    if (!open || workspaces) return;
    fetch("/api/workspaces").then(async (response) => {
      if (response.ok) setWorkspaces(await response.json());
    });
  }, [open, workspaces]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="relative w-full min-w-0" ref={ref}>
      <button
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-hairline bg-white/5 px-3 py-2.5 text-sm font-medium text-white/80 transition hover:border-teal-light hover:bg-white/10 hover:text-white"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            current.kind === "propertyos"
              ? "bg-teal-light"
              : current.kind === "marketplace"
                ? "bg-gold"
                : "bg-emerald-400"
          }`}
        />
        <span className="min-w-0 flex-1 truncate text-left">{current.label}</span>
        <span className="shrink-0 text-white/50">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-2 max-h-[min(60vh,420px)] w-full min-w-0 overflow-y-auto overflow-x-hidden rounded-2xl border border-hairline bg-white p-2 shadow-xl">
          <p className="break-words px-2 py-1.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.12em] text-teal">NesAfric management organisations</p>
          {!workspaces ? (
            <p className="px-2 py-2 text-sm text-muted">Loading…</p>
          ) : workspaces.propertyOsOrganisations.length === 0 ? (
            <div className="px-2 py-2">
              <p className="text-sm text-muted">No NesAfric management organisations yet.</p>
              <Link className="mt-1 inline-block text-sm font-semibold text-teal" href="/onboarding" onClick={() => setOpen(false)}>Create one →</Link>
            </div>
          ) : (
            workspaces.propertyOsOrganisations.map((org) => (
              <button
                className="block w-full min-w-0 rounded-xl px-2.5 py-2 text-left text-sm text-forest transition hover:bg-cream"
                key={org.id}
                onClick={() => selectOrganisation(org.id)}
                type="button"
              >
                <span className="block truncate">{org.name}</span>
              </button>
            ))
          )}

          <p className="mt-2 break-words border-t border-hairline px-2 pb-1 pt-2.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.12em] text-emerald-700">
            Service Provider workspaces
          </p>
          {!workspaces ? (
            <p className="px-2 py-2 text-sm text-muted">Loading…</p>
          ) : workspaces.serviceProviders.length === 0 ? (
            <Link
              className="block min-w-0 rounded-xl px-2.5 py-2 text-sm font-medium leading-5 text-teal hover:bg-cream"
              href="/providers/new"
              onClick={() => setOpen(false)}
            >
              + Register a service provider
            </Link>
          ) : (
            workspaces.serviceProviders.map((provider) => (
              <Link
                className="block min-w-0 rounded-xl px-2.5 py-2 text-sm text-forest hover:bg-cream"
                href={`/providers/${provider.id}`}
                key={provider.id}
                onClick={() => setOpen(false)}
              >
                <span className="block truncate">{provider.displayName}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {provider.suspended
                    ? "Suspended"
                    : provider.verificationStatus === "VERIFIED"
                      ? "Verified"
                      : provider.verificationStatus === "PENDING"
                        ? "Verification pending"
                        : provider.verificationStatus === "REQUIRES_MORE_INFORMATION"
                          ? "More information required"
                          : provider.verificationStatus === "REJECTED"
                            ? "Verification rejected"
                            : "Awaiting submission"}
                </span>
              </Link>
            ))
          )}

          <p className="mt-2 break-words border-t border-hairline px-2 pb-1 pt-2.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.12em] text-gold">Marketplace Professional profiles</p>
          {!workspaces ? (
            <p className="px-2 py-2 text-sm text-muted">Loading…</p>
          ) : workspaces.marketplaceProfessionals.length === 0 ? (
            <Link className="block min-w-0 rounded-xl px-2.5 py-2 text-sm font-medium leading-5 text-teal hover:bg-cream" href="/pro/new" onClick={() => setOpen(false)}>
              + Create a marketplace profile
            </Link>
          ) : (
            workspaces.marketplaceProfessionals.map((professional) => (
              <Link className="block min-w-0 rounded-xl px-2.5 py-2 text-sm text-forest hover:bg-cream" href={`/pro/${professional.id}`} key={professional.id} onClick={() => setOpen(false)}>
                <span className="block truncate">{professional.displayName}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
