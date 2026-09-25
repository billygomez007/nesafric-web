"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/**
 * The signed-in person, read from the existing account profile endpoint and linking to account
 * settings. Renders nothing until the profile is known, so it never shows a placeholder identity.
 */
export function AccountChip({ context }: { context: string }) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/account/profile", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { displayName?: string };
        if (body.displayName) setName(body.displayName);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!name) return null;

  return (
    <Link
      aria-label={`Account settings for ${name}`}
      className="flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-2 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-strong"
      href="/settings"
    >
      <span className="hidden text-right sm:block">
        <span className="block max-w-[200px] truncate text-[13px] font-semibold text-ink">{name}</span>
        <span className="block text-[11px] text-muted">{context}</span>
      </span>
      <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-forest text-xs font-semibold text-white">
        {initials(name)}
      </span>
    </Link>
  );
}
