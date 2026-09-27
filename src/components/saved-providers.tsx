"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * The signed-in user's saved service providers for a page, loaded ONCE from
 * `GET /api/marketplace/saved-providers` and shared by every card / the profile on it (no per-card
 * status requests). The server is the only store: a heart changes only after the server accepts the
 * save or removal, and a refusal is reported next to it. A 401 means the visitor is signed out;
 * saving then goes through the existing `/login?returnTo=` flow back to this page.
 */
type Status = "loading" | "signedIn" | "signedOut" | "unavailable";

type SavedProvidersValue = {
  status: Status;
  isSaved: (providerId: string) => boolean;
  isPending: (providerId: string) => boolean;
  errorFor: (providerId: string) => string | null;
  toggle: (providerId: string) => Promise<void>;
};

const SavedProvidersContext = createContext<SavedProvidersValue | null>(null);

export function signInHrefForCurrentPage() {
  const here = typeof window === "undefined" ? "/marketplace/services" : `${window.location.pathname}${window.location.search}`;
  return `/login?returnTo=${encodeURIComponent(here)}`;
}

async function readError(response: Response, fallback: string) {
  try {
    return (await response.json())?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function SavedProvidersProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    let active = true;
    fetch("/api/marketplace/saved-providers", { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) return setStatus("signedOut");
        if (!response.ok) return setStatus("unavailable");
        const body = (await response.json()) as { items: { providerId: string }[] };
        setSaved(new Set(body.items.map(({ providerId }) => providerId)));
        setStatus("signedIn");
      })
      .catch(() => active && setStatus("unavailable"));
    return () => {
      active = false;
    };
  }, []);

  const toggle = useCallback(async (providerId: string) => {
    if (status === "signedOut") {
      window.location.assign(signInHrefForCurrentPage());
      return;
    }
    if (status !== "signedIn" || pending.has(providerId)) return;
    const wasSaved = saved.has(providerId);
    setPending((current) => new Set(current).add(providerId));
    setErrors((current) => { const next = new Map(current); next.delete(providerId); return next; });
    try {
      const response = await fetch(`/api/marketplace/saved-providers/${encodeURIComponent(providerId)}`, { method: wasSaved ? "DELETE" : "POST" });
      if (response.status === 401) {
        setStatus("signedOut");
        throw new Error("Your session has ended. Sign in again to save providers.");
      }
      if (!response.ok) {
        throw new Error(response.status === 404 ? "This provider is no longer listed." : await readError(response, wasSaved ? "Couldn’t remove this provider." : "Couldn’t save this provider."));
      }
      setSaved((current) => {
        const next = new Set(current);
        if (wasSaved) next.delete(providerId);
        else next.add(providerId);
        return next;
      });
    } catch (cause) {
      setErrors((current) => new Map(current).set(providerId, cause instanceof Error ? cause.message : "Something went wrong."));
    } finally {
      setPending((current) => { const next = new Set(current); next.delete(providerId); return next; });
    }
  }, [pending, saved, status]);

  const value = useMemo<SavedProvidersValue>(() => ({
    status,
    isSaved: (providerId) => saved.has(providerId),
    isPending: (providerId) => pending.has(providerId),
    errorFor: (providerId) => errors.get(providerId) ?? null,
    toggle,
  }), [errors, pending, saved, status, toggle]);

  return <SavedProvidersContext.Provider value={value}>{children}</SavedProvidersContext.Provider>;
}

export function useSavedProviders() {
  const context = useContext(SavedProvidersContext);
  if (!context) throw new Error("useSavedProviders must be used inside <SavedProvidersProvider>.");
  return context;
}

/** Save / Unsave, with an accessible name that says what pressing it will do. */
export function SaveProviderButton({ providerId, name, variant = "icon" }: { providerId: string; name: string; variant?: "icon" | "full" }) {
  const { status, isSaved, isPending, errorFor, toggle } = useSavedProviders();
  const saved = isSaved(providerId);
  const busy = isPending(providerId) || status === "loading";
  const error = errorFor(providerId);
  const label = saved ? `Remove ${name} from saved providers` : `Save ${name}`;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        aria-busy={busy}
        aria-label={label}
        aria-pressed={saved}
        className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-hairline bg-white text-sm font-semibold text-forest transition hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-wait ${variant === "icon" ? "h-10 w-10" : "px-4"}`}
        data-testid={`save-provider-${providerId}`}
        disabled={busy || status === "unavailable"}
        onClick={() => void toggle(providerId)}
        title={label}
        type="button"
      >
        <svg aria-hidden="true" className={`h-5 w-5 ${saved ? "text-danger" : "text-forest"}`} fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.9 4.5 7.3 4.5c2 0 3.5 1.1 4.7 2.7 1.2-1.6 2.7-2.7 4.7-2.7 3.4 0 5.7 3.3 4.5 6.7-1.7 4.7-9.2 9.3-9.2 9.3Z" /></svg>
        {variant === "full" ? <span>{isPending(providerId) ? (saved ? "Removing…" : "Saving…") : saved ? "Saved" : "Save"}</span> : null}
      </button>
      {error ? <p className="max-w-48 text-right text-xs font-medium text-danger-ink" role="alert">{error}</p> : null}
    </div>
  );
}
