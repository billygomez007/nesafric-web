"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Workspace = {
  propertyOsOrganisations: Array<{ id: string; name: string }>;
  marketplaceProfessionals: Array<{ id: string; displayName: string; type: string; myRole: string }>;
};

/**
 * Dual-workspace switcher (item 10) — a single identity acting across two clearly separate
 * business sides: PropertyOS Management organisations and Marketplace Professional profiles.
 * Never merges the two lists; switching only ever changes which workspace's shell is shown,
 * never the signed-in identity itself.
 */
export function WorkspaceSwitcher({ current }: { current: { kind: "propertyos" | "marketplace"; label: string } }) {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  function selectOrganisation(organisationId: string) {
    localStorage.setItem("propertyos.activeOrganisationId", organisationId);
    setOpen(false);
    // A full reload guarantees every PropertyOS page (each reads the active organisation from
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
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-1.5 rounded-xl border border-hairline bg-white/5 px-3 py-2 text-sm font-medium text-white/80 transition hover:border-teal-light hover:bg-white/10 hover:text-white"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${current.kind === "propertyos" ? "bg-teal-light" : "bg-gold"}`} />
        {current.label}
        <span className="text-white/50">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-hairline bg-white p-2 shadow-xl">
          <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-teal">PropertyOS organisations</p>
          {!workspaces ? (
            <p className="px-2 py-2 text-sm text-muted">Loading…</p>
          ) : workspaces.propertyOsOrganisations.length === 0 ? (
            <div className="px-2 py-2">
              <p className="text-sm text-muted">No PropertyOS organisations yet.</p>
              <Link className="mt-1 inline-block text-sm font-semibold text-teal" href="/onboarding" onClick={() => setOpen(false)}>Create one →</Link>
            </div>
          ) : (
            workspaces.propertyOsOrganisations.map((org) => (
              <button
                className="block w-full rounded-xl px-2 py-2 text-left text-sm text-forest transition hover:bg-cream"
                key={org.id}
                onClick={() => selectOrganisation(org.id)}
                type="button"
              >
                {org.name}
              </button>
            ))
          )}

          <p className="mt-2 border-t border-hairline px-2 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide text-gold">Marketplace Professional profiles</p>
          {!workspaces ? (
            <p className="px-2 py-2 text-sm text-muted">Loading…</p>
          ) : workspaces.marketplaceProfessionals.length === 0 ? (
            <Link className="block rounded-xl px-2 py-2 text-sm font-medium text-teal hover:bg-cream" href="/pro/new" onClick={() => setOpen(false)}>
              + Create a marketplace profile
            </Link>
          ) : (
            workspaces.marketplaceProfessionals.map((professional) => (
              <Link className="block rounded-xl px-2 py-2 text-sm text-forest hover:bg-cream" href={`/pro/${professional.id}`} key={professional.id} onClick={() => setOpen(false)}>
                {professional.displayName}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
