"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui/button-styles";

/** App-wide error boundary: plain language, a retry, and a way out. Never shows the raw error. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center bg-warm-white px-5 py-16 sm:px-8">
      <div className="mx-auto w-full max-w-xl">
        <p className="text-sm font-medium text-gold-ink">Something went wrong</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-forest-deep">This page didn&apos;t load properly.</h1>
        <p className="mt-4 text-base leading-7 text-muted">
          Your data is safe. Try again — if it keeps happening, contact support and mention the reference below.
        </p>
        {error.digest && <p className="mt-3 font-mono text-xs text-slate-500">Reference: {error.digest}</p>}
        <div className="mt-8 flex flex-wrap gap-3">
          <button className={buttonClass("primary")} onClick={() => retry()} type="button">
            Try again
          </button>
          <Link className={buttonClass("secondary")} href="/">
            Go to the homepage
          </Link>
        </div>
      </div>
    </main>
  );
}
