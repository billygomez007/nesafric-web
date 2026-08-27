"use client";

import Link from "next/link";
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
        className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-300"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${current.kind === "propertyos" ? "bg-emerald-500" : "bg-indigo-500"}`} />
        {current.label}
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Property Management</p>
          {!workspaces ? (
            <p className="px-2 py-2 text-sm text-slate-400">Loading…</p>
          ) : workspaces.propertyOsOrganisations.length === 0 ? (
            <p className="px-2 py-2 text-sm text-slate-400">No PropertyOS organisations yet.</p>
          ) : (
            workspaces.propertyOsOrganisations.map((org) => (
              <Link className="block rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50" href="/dashboard" key={org.id} onClick={() => setOpen(false)}>
                {org.name}
              </Link>
            ))
          )}

          <p className="mt-2 border-t border-slate-100 px-2 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Marketplace Professional</p>
          {!workspaces ? (
            <p className="px-2 py-2 text-sm text-slate-400">Loading…</p>
          ) : workspaces.marketplaceProfessionals.length === 0 ? (
            <Link className="block rounded-lg px-2 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50" href="/pro/new" onClick={() => setOpen(false)}>
              + Create a marketplace profile
            </Link>
          ) : (
            workspaces.marketplaceProfessionals.map((professional) => (
              <Link className="block rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50" href={`/pro/${professional.id}`} key={professional.id} onClick={() => setOpen(false)}>
                {professional.displayName}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
