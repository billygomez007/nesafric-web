import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One figure in a summary row: label, value, a short explanation, and a link to the records
 * behind it. No icon tile — the number and what it means carry the weight. `icon` and `tone`
 * are still accepted so existing call sites compile; `tone="red"` marks the figure as needing
 * attention.
 */
export function DashboardStat({
  label,
  value,
  helper,
  href,
  tone = "teal",
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  icon?: ReactNode;
  href?: string;
  tone?: "teal" | "gold" | "forest" | "red";
}) {
  const body = (
    <div
      className={`group h-full border-t py-4 transition-colors duration-150 ${
        tone === "red" ? "border-danger" : "border-forest/25 group-hover:border-forest"
      }`}
    >
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className={`mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.02em] tabular-nums ${tone === "red" ? "text-danger-ink" : "text-ink"}`}>
        {value}
      </div>
      {helper && <div className="mt-1 text-xs leading-5 text-muted">{helper}</div>}
      {href && (
        <span className="mt-2 inline-block text-xs font-semibold text-forest group-hover:underline">
          View <span className="sr-only">{label.toLowerCase()}</span>
          <span aria-hidden="true"> →</span>
        </span>
      )}
    </div>
  );

  return href ? (
    <Link className="group block rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-strong" href={href}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function DashboardPanel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-white ${className}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-5 sm:px-6">
        <div>
          <h2 className="font-sans text-[15px] font-semibold text-ink">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-xs leading-5 text-muted">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>

      {children}
    </section>
  );
}

export function ProgressBar({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  const safe = Math.max(0, Math.min(100, value));

  return (
    <div className={`h-1.5 overflow-hidden rounded-[1px] bg-cream ${className}`}>
      <div
        className="h-full bg-forest transition-[width] duration-500"
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "gold";
}) {
  const tones = {
    neutral: "bg-surface text-slate-600",
    success: "bg-success-tint text-success",
    warning: "bg-warning-tint text-warning-ink",
    danger: "bg-danger-tint text-danger-ink",
    gold: "bg-gold/15 text-gold-ink",
  };

  return (
    <span className={`inline-flex items-center rounded-[3px] px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function DashboardIcon({
  name,
}: {
  name:
    | "building"
    | "units"
    | "money"
    | "maintenance"
    | "users"
    | "listing"
    | "leads"
    | "calendar"
    | "chart";
}) {
  const paths = {
    building: (
      <>
        <path d="M4 21V7l8-4 8 4v14" />
        <path d="M8 10h2M14 10h2M8 14h2M14 14h2M10 21v-4h4v4" />
      </>
    ),
    units: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" />
      </>
    ),
    money: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 9h18M7 15h4" />
      </>
    ),
    maintenance: (
      <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-3-3z" />
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2" />
        <path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6M15 15c3-.2 5 1.3 5.5 4" />
      </>
    ),
    listing: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9h10M7 13h7M7 17h5" />
      </>
    ),
    leads: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M5 21a7 7 0 0 1 14 0" />
        <path d="M18 5h3M19.5 3.5v3" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}
